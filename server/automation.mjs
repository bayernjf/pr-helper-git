// Bridge module: wires the pr-helper automation engine (workflows-store.mjs)
// into the local server lifecycle. Provides:
//   1. DATABASE_URL pointing at the local OrbStack Postgres
//   2. Drain (2 min) + reconcile (5 min) + retention cleanup schedulers
//   3. Shadow mode: read-only observation (queue/tracked counts) — the engine
//      itself has no dry-run seam, so shadow never calls executing entrypoints
//   4. GitHub webhook receiver endpoint handler
//
// The engine reads all configuration from the `environment` object passed to
// each function — this module builds that object from the server's env +
// local Postgres URL.

import { createHmac, timingSafeEqual } from 'node:crypto';
import postgres from 'postgres';
import * as store from './workflows-store.mjs';

const DRAIN_INTERVAL_MS = 2 * 60_000;
const RECONCILE_INTERVAL_MS = 5 * 60_000;
const RETENTION_INTERVAL_MS = 24 * 60 * 60_000;

let shadowMode = process.env.PR_HELPER_AUTOMATION_SHADOW === '1';
let timers = [];

function databaseUrl() {
  return process.env.PR_HELPER_GIT_DATABASE_URL
    || 'postgres://postgres:localdev@127.0.0.1:54329/pr_helper';
}

function environment() {
  return { ...process.env, DATABASE_URL: databaseUrl() };
}

export function isShadowMode() { return shadowMode; }
export function setShadowMode(on) { shadowMode = !!on; }

/** Start the drain/reconcile/cleanup schedulers. Idempotent. */
export function startAutomation() {
  if (timers.length > 0) return;
  timers = [
    setInterval(() => runDrain().catch(() => undefined), DRAIN_INTERVAL_MS),
    setInterval(() => runReconcile('cron').catch(() => undefined), RECONCILE_INTERVAL_MS),
    setInterval(() => runRetention().catch(() => undefined), RETENTION_INTERVAL_MS),
  ];
  // Fire an initial drain shortly after start (queue may have pending actions).
  setTimeout(() => runDrain().catch(() => undefined), 5000);
  console.error(`[automation] schedulers started (drain ${DRAIN_INTERVAL_MS / 1000}s, reconcile ${RECONCILE_INTERVAL_MS / 1000}s, retention daily)${shadowMode ? ' — SHADOW MODE' : ''}`);
}

export function stopAutomation() {
  for (const t of timers) clearInterval(t);
  timers = [];
}

async function runDrain() {
  if (shadowMode) return shadowObserve('drain');
  const env = environment();
  try {
    const result = await store.drainWorkflowAutomationActions(env);
    console.error(`[automation] drain ok: ${summarize(result)}`);
  } catch (err) {
    console.error(`[automation] drain failed: ${err.message}`);
  }
}

async function runReconcile(trigger = 'cron') {
  if (shadowMode) return shadowObserve('reconcile');
  const env = environment();
  try {
    const result = await store.reconcileWorkflowStages(env, {}, trigger);
    console.error(`[automation] reconcile(${trigger}) ok: ${summarize(result)}`);
  } catch (err) {
    console.error(`[automation] reconcile(${trigger}) failed: ${err.message}`);
  }
}

async function runRetention() {
  if (shadowMode) return;
  const env = environment();
  try {
    const result = await store.cleanupRetainedData(env);
    console.error(`[automation] retention ok: ${summarize(result)}`);
  } catch (err) {
    console.error(`[automation] retention failed: ${err.message}`);
  }
}

/**
 * Shadow mode: read-only observation. The engine has no dry-run seam, so
 * shadow mode never invokes drain/reconcile/retention — it reports what is
 * queued and tracked, with zero side effects (Phase 5 影子并行 relies on this).
 */
async function shadowObserve(kind) {
  const sql = postgres(databaseUrl(), { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 5 });
  try {
    const [queue] = await sql`
      SELECT
        count(*) FILTER (WHERE state = 'queued')::int AS queued,
        count(*) FILTER (WHERE state = 'running')::int AS running,
        count(*) FILTER (WHERE state = 'paused')::int AS paused
      FROM workflow_automation_actions
      WHERE state IN ('queued', 'running', 'paused')`;
    const [tracked] = await sql`
      SELECT count(*)::int AS workflows
      FROM pr_helper_workflows
      WHERE archived = false`;
    console.error(`[automation:shadow] ${kind} observe: queue q=${queue.queued} r=${queue.running} p=${queue.paused}, tracked workflows=${tracked.workflows}`);
  } catch (err) {
    console.error(`[automation:shadow] ${kind} observe failed: ${err.message}`);
  } finally {
    await sql.end({ timeout: 0 }).catch(() => undefined);
  }
}

/** One-line, bounded summary of an engine result for the server log. */
function summarize(result) {
  if (result === undefined || result === null) return 'ok';
  try {
    const s = JSON.stringify(result);
    return s.length <= 200 ? s : `${s.slice(0, 197)}…`;
  } catch {
    return String(result).slice(0, 200);
  }
}

/**
 * Handle a GitHub webhook delivery, mirroring pr-helper's
 * api/github/webhook.ts flow: dedup the delivery, project pull-request state
 * into workflow_stage_states, then run a branch-scoped realtime reconcile
 * when the event can change stage state. Returns { status, json } or null
 * (not a webhook route).
 */
export async function handleGithubWebhook({ method, pathname, headers, rawBody, secret }) {
  if (pathname !== '/api/github-webhook' || method !== 'POST') return null;
  if (!rawBody) return { status: 400, json: { error: 'raw body required' } };

  // Fail closed without a secret — an unauthenticated receiver would let any
  // local process forge pull state.
  if (!secret) return { status: 503, json: { error: 'GITHUB_WEBHOOK_SECRET is not configured' } };
  const signature = headers['x-hub-signature-256'] || '';
  if (!verifyHmac(rawBody, signature, secret)) {
    return { status: 401, json: { error: 'invalid signature' } };
  }

  const deliveryId = headers['x-github-delivery'] || '';
  const eventName = headers['x-github-event'] || '';
  if (!deliveryId || !eventName) {
    return { status: 400, json: { error: 'missing event headers' } };
  }

  let payload;
  try { payload = JSON.parse(rawBody); } catch { return { status: 400, json: { error: 'invalid JSON' } }; }

  if (shadowMode) {
    console.error(`[automation:shadow] webhook ${eventName} (${deliveryId}) received — not projected`);
    return { status: 200, json: { ok: true, shadow: true } };
  }

  const repository = payload.repository?.full_name || undefined;
  const installationId = payload.installation?.id ? String(payload.installation.id) : undefined;
  const env = environment();
  const accepted = await store.recordWebhookDelivery(env, {
    deliveryId, eventName, action: payload.action, repository, installationId,
  });

  const pull = payload.pull_request;
  const projectedStages = accepted && eventName === 'pull_request' && pull && repository && installationId
    ? await store.projectPullRequestWebhook(env, {
        repository,
        installationId,
        source: pull.head.ref,
        target: pull.base.ref,
        number: pull.number,
        state: pull.state,
        mergedAt: pull.merged_at,
      })
    : 0;

  const shouldReconcile = accepted && Boolean(repository && installationId)
    && store.webhookCanChangeStageState(eventName, payload.action);
  const branches = shouldReconcile ? store.webhookBranchesForEvent(eventName, payload) : null;
  const reconciliation = shouldReconcile
    ? await store.reconcileRealtime(env, {
        repository, installationId, eventName,
        ...(branches ? { branches } : {}),
      }, 'webhook')
    : null;

  return {
    status: 202,
    json: { accepted, duplicate: !accepted, projectedStages, reconciliationScheduled: shouldReconcile, reconciliation },
  };
}

function verifyHmac(body, signature, secret) {
  const expected = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch { return false; }
}
