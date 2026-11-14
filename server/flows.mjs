// Control-tower routes (Phase 3, ledger docs/pr-helper-migration.md P3-0):
// exposes the migrated pr-helper automation engine's read surface to the web
// client, replacing pr-helper's Vercel functions (api/[action].ts inbox
// handler, api/workflows.ts).
//
// Identity bridge: pr-helper's engine resolves the user from
// { login, githubUserId, installationId } (its GitHub App session). The local
// server authenticates with instance/member tokens instead, so flow routes
// adopt the single imported pr_helper_users row as the engine identity
// (single-user local product; P2-8 will widen this to role mapping).
//
// Board reads return the persisted projection directly (list* fan-out), so
// they need no GitHub credentials; live refresh rides the scheduled reconcile
// and the webhook receiver until P2-1 wires explicit credentials.

import * as store from './workflows-store.mjs';
import postgres from 'postgres';

let cachedIdentity = null;
let cachedIdentityUrl = '';

function databaseUrl() {
  return process.env.PR_HELPER_GIT_DATABASE_URL
    || 'postgres://postgres:localdev@127.0.0.1:54329/pr_helper';
}

/**
 * Engine identity for the current single-user instance: the one imported
 * pr_helper_users row. Cached until the database URL changes.
 */
export async function flowIdentity() {
  const url = databaseUrl();
  if (cachedIdentity && cachedIdentityUrl === url) return cachedIdentity;
  const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 5 });
  try {
    const rows = await sql`
      SELECT github_login, github_user_id, github_installation_id
      FROM pr_helper_users ORDER BY created_at LIMIT 2`;
    if (rows.length === 0) {
      throw new Error('pr_helper_users 为空：先执行迁移导入（scripts/migration/import-supabase-data.mjs）');
    }
    if (rows.length > 1) {
      throw new Error(`pr_helper_users 有 ${rows.length} 行：多人身份桥接尚未配置（P2-8）`);
    }
    const row = rows[0];
    cachedIdentity = {
      login: row.github_login,
      githubUserId: row.github_user_id === null ? undefined : Number(row.github_user_id),
      installationId: row.github_installation_id || undefined,
    };
    cachedIdentityUrl = url;
    return cachedIdentity;
  } finally {
    await sql.end({ timeout: 0 }).catch(() => undefined);
  }
}

/** Test hook: drop the cached identity (e.g. after pointing at another DB). */
export function resetFlowIdentityCache() {
  cachedIdentity = null;
  cachedIdentityUrl = '';
}

function environment() {
  return { ...process.env, DATABASE_URL: databaseUrl() };
}

/**
 * Control-tower read routes. Auth is enforced by the caller (main.mjs runs
 * this after token resolution). Returns null when the path is not ours.
 */
export async function handleFlowsRoute(ctx) {
  const { method, pathname, query } = ctx;
  if (!pathname.startsWith('/api/flows') || method !== 'GET') return null;

  try {
    const identity = await flowIdentity();
    const env = environment();

    // Board payload: the same eleven-collection fan-out pr-helper's
    // /api/[action]?action=inbox served. Reconciliation is NOT triggered
    // inline here — the board renders the persisted projection and live
    // refresh arrives via webhook / scheduled sweep.
    //
    // Reads that need GitHub App credentials (dynamic branch-source stages)
    // degrade to empty collections with a warning instead of failing the
    // whole board: until P2-1 lands the credentials locally, the persisted
    // projection is still complete for static-route workflows.
    if (pathname === '/api/flows/inbox') {
      const reads = {};
      const readNames = [
        ['items', store.listActionableStages],
        ['states', store.listWorkflowStageStates],
        ['events', store.listRecentWorkflowStageEvents],
        ['deployments', store.listWorkflowStageDeployments],
        ['deploymentRuns', store.listWorkflowStageDeploymentRuns],
        ['configurationWarnings', store.listWorkflowConfigurationWarnings],
        ['syncHealth', store.listSyncHealth],
        ['runs', store.listWorkflowRuns],
        ['timeline', store.listWorkflowTimeline],
        ['recoveryStatuses', store.listRecoveryStatuses],
        ['automation', (env, identity, reads) => store.listWorkflowAutomationActions(env, identity, undefined, true, reads)],
      ];
      const settled = await Promise.allSettled(
        readNames.map(([, fn]) => fn(env, identity, reads)),
      );
      const payload = {};
      const readWarnings = [];
      settled.forEach((outcome, i) => {
        const [key] = readNames[i];
        if (outcome.status === 'fulfilled') {
          payload[key] = outcome.value;
        } else {
          payload[key] = [];
          readWarnings.push({ source: key, message: outcome.reason?.message || String(outcome.reason) });
        }
      });
      return { status: 200, json: { ...payload, readWarnings } };
    }

    // Raw workflow payloads (editor, P3-4).
    if (pathname === '/api/flows/workflows') {
      const workflows = await store.listWorkflows(env, identity);
      return { status: 200, json: { workflows } };
    }

    // Operation audit log (M-F14; CSV export is a client-side concern).
    if (pathname === '/api/flows/audit') {
      const limit = Math.max(1, Math.min(500, Number(query.get('limit')) || 100));
      const entries = await store.listOperationAuditLogs(env, identity, limit);
      return { status: 200, json: { entries } };
    }

    return { status: 404, json: { error: 'unknown flows route' } };
  } catch (err) {
    return { status: 500, json: { error: err.message || 'flows read failed' } };
  }
}
