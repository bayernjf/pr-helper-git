// Bridge module: wires the pr-helper automation engine (workflows-store.mjs)
// into the local server lifecycle. Provides:
//   1. DATABASE_URL pointing at the local OrbStack Postgres
//   2. Drain (2 min) + reconcile (5 min) + retention cleanup schedulers
//   3. Shadow mode toggle (engine computes decisions but does not execute)
//   4. GitHub webhook receiver endpoint handler
//
// The engine reads all configuration from the `environment` object passed to
// each function — this module builds that object from the server's env +
// local Postgres URL.

import * as store from './workflows-store.mjs';

const DRAIN_INTERVAL_MS = 2 * 60_000;
const RECONCILE_INTERVAL_MS = 5 * 60_000;
const RETENTION_INTERVAL_MS = 24 * 60 * 60_000;

let shadowMode = process.env.PR_HELPER_AUTOMATION_SHADOW === '1';
let timers = [];

function environment() {
  return {
    ...process.env,
    DATABASE_URL: process.env.PR_HELPER_GIT_DATABASE_URL
      || 'postgres://postgres:localdev@127.0.0.1:54329/pr_helper',
  };
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
}

export function stopAutomation() {
  for (const t of timers) clearInterval(t);
  timers = [];
}

async function runDrain() {
  const env = environment();
  if (shadowMode) {
    // Shadow: compute decisions but skip execution.
    const result = await store.drainWorkflowAutomationActions(env);
    console.error(`[automation:shadow] drain decision: ${JSON.stringify(result).slice(0, 200)}`);
    return;
  }
  await store.drainWorkflowAutomationActions(env);
}

async function runReconcile(trigger = 'cron') {
  const env = environment();
  if (shadowMode) {
    const result = await store.reconcileWorkflowStages(env, {}, trigger, { shadow: true });
    console.error(`[automation:shadow] reconcile: ${JSON.stringify(result).slice(0, 200)}`);
    return;
  }
  await store.reconcileWorkflowStages(env, {}, trigger);
}

async function runRetention() {
  const env = environment();
  await store.cleanupRetainedData(env);
}

/**
 * Handle a GitHub webhook delivery. Verifies the HMAC signature, then
 * delegates to the engine's webhook projection. Returns { status, json } or
 * null (not a webhook route).
 */
export async function handleGithubWebhook({ method, pathname, headers, body, rawBody, secret }) {
  if (pathname !== '/api/github-webhook' || method !== 'POST') return null;
  if (!rawBody) return { status: 400, json: { error: 'raw body required' } };

  // HMAC signature verification (ported from pr-helper's github-webhook.ts).
  const signature = headers['x-hub-signature-256'] || '';
  if (secret && !verifyHmac(rawBody, signature, secret)) {
    return { status: 401, json: { error: 'invalid signature' } };
  }

  let event;
  try { event = JSON.parse(rawBody); } catch { return { status: 400, json: { error: 'invalid JSON' } }; }
  const eventType = headers['x-github-event'] || 'unknown';
  const deliveryId = headers['x-github-delivery'] || '';

  const env = environment();
  if (shadowMode) {
    console.error(`[automation:shadow] webhook ${eventType} delivery ${deliveryId} received (shadow mode, not executed)`);
    return { status: 200, json: { ok: true, shadow: true } };
  }

  // Delegate to the engine's webhook projection.
  const result = await store.projectPullRequestWebhook(env, event, eventType, deliveryId);
  return { status: 200, json: { ok: true, result } };
}

function verifyHmac(body, signature, secret) {
  const { createHmac, timingSafeEqual } = require('node:crypto');
  const expected = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch { return false; }
}
