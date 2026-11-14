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
 * Control-tower routes. Auth is enforced by the caller (main.mjs runs this
 * after token resolution). Returns null when the path is not ours.
 *
 * Read routes mirror pr-helper's /api/[action]?action=inbox; write routes
 * mirror api/workflows.ts resource=automation (P3-3): enqueue / execute /
 * regenerate / takeover, plus the recovery-event registration from
 * api/[action].ts. They fail loudly until P2-1 lands the GitHub credentials —
 * the client surfaces the error message as-is.
 */
export async function handleFlowsRoute(ctx) {
  const { method, pathname, query, body } = ctx;
  if (!pathname.startsWith('/api/flows')) return null;

  try {
    const identity = await flowIdentity();
    const env = environment();
    const payload = body && typeof body === 'object' ? body : {};

    // --- Write routes (P3-3), mirroring api/workflows.ts resource=automation
    // --- and the recovery/rerun registrations from api/[action].ts. They fail
    // --- loudly until P2-1 lands the GitHub credentials.
    if (method === 'POST' && pathname === '/api/flows/automation') {
      const actionId = typeof payload.actionId === 'number' ? payload.actionId : Number(payload.actionId);
      switch (query.get('action')) {
        case 'execute':
          return { status: 200, json: { result: await store.executeWorkflowAutomationAction(env, identity, actionId) } };
        case 'regenerate':
          return { status: 200, json: { result: await store.regenerateAutomationMessage(env, identity, actionId) } };
        case 'takeover':
          return {
            status: 200,
            json: {
              result: await store.takeoverAutomationAction(
                env, identity, actionId,
                typeof payload.title === 'string' ? payload.title : '',
                typeof payload.body === 'string' ? payload.body : '',
              ),
            },
          };
        case undefined:
        case '':
        case null: {
          // Plain POST = enqueue a new automation action (board/drawer buttons).
          const result = await store.enqueueWorkflowAutomationAction(env, identity, {
            workflowId: typeof payload.workflowId === 'string' ? payload.workflowId : '',
            stageIndex: typeof payload.stageIndex === 'number' ? payload.stageIndex : -1,
            source: typeof payload.source === 'string' ? payload.source : '',
            kind: payload.kind === 'merge-pr' || payload.kind === 'advance-stage' ? payload.kind : 'create-pr',
            idempotencyKey: typeof payload.idempotencyKey === 'string' ? payload.idempotencyKey : '',
          });
          return { status: 200, json: { action: result } };
        }
        default:
          return { status: 400, json: { error: `unknown automation action: ${query.get('action')}` } };
      }
    }

    if (method === 'POST' && pathname === '/api/flows/recovery-event') {
      if (typeof payload.workflowId !== 'string' || typeof payload.stageIndex !== 'number' || typeof payload.source !== 'string') {
        return { status: 400, json: { error: '无效的失败恢复请求' } };
      }
      await store.recordRecoveryEvent(env, identity, {
        workflowId: payload.workflowId,
        stageIndex: payload.stageIndex,
        source: payload.source,
      });
      return { status: 200, json: { ok: true } };
    }

    if (method === 'POST' && pathname === '/api/flows/rerun-actions') {
      if (typeof payload.workflowId !== 'string' || typeof payload.stageIndex !== 'number' || typeof payload.source !== 'string') {
        return { status: 400, json: { error: '无效的 Actions 重跑请求' } };
      }
      const result = await store.rerunFailedActions(env, identity, {
        workflowId: payload.workflowId,
        stageIndex: payload.stageIndex,
        source: payload.source,
      });
      return { status: 200, json: { result } };
    }

    // --- Workflow payload writes (P3-4), mirroring api/workflows.ts PUT/
    // --- PATCH/DELETE. Upstream re-verifies repository ownership via the
    // GitHub App API (IDOR guard); locally the token itself is the boundary
    // (single-user), so that check has no remote counterpart until P2-1.
    if (method === 'PUT' && pathname === '/api/flows/workflows') {
      if (!store.isStoredWorkflow(payload.workflow)) {
        return { status: 400, json: { error: '无效的流程负载' } };
      }
      const saved = await store.upsertWorkflow(env, identity, payload.workflow);
      // Either toggle earns an immediate sweep upstream. Without credentials
      // locally the sweep degrades to the scheduled/webhook reconcile.
      const shouldReconcile = (saved.automationActivated.create || saved.automationActivated.merge || saved.gatesChanged)
        && Boolean(identity.installationId);
      // A failed inline sweep must not fail the save itself — the workflow is
      // already persisted and the scheduled/webhook reconcile catches up.
      const reconciliation = shouldReconcile
        ? await store.reconcileRealtime(env, { installationId: identity.installationId, repository: saved.workflow.repository, eventName: 'automation_enabled' }, 'manual').catch(() => null)
        : null;
      return { status: 200, json: { ok: true, workflow: saved.workflow, automationActivated: saved.automationActivated, gatesChanged: saved.gatesChanged, reconciliation } };
    }

    if (method === 'PATCH' && pathname === '/api/flows/workflows') {
      if (typeof payload.workflowId !== 'string' || typeof payload.stageId !== 'string') {
        return { status: 400, json: { error: '无效的步骤删除请求' } };
      }
      const workflow = await store.removeWorkflowStage(
        env, identity, payload.workflowId, payload.stageId,
        typeof payload.stageIndex === 'number' ? payload.stageIndex : undefined,
        typeof payload.source === 'string' ? payload.source : undefined,
        typeof payload.target === 'string' ? payload.target : undefined,
      );
      return { status: 200, json: { ok: true, workflow } };
    }

    if (method === 'DELETE' && pathname === '/api/flows/workflows') {
      if (typeof payload.id !== 'string') {
        return { status: 400, json: { error: '无效的流程删除请求' } };
      }
      await store.removeWorkflow(env, identity, payload.id);
      return { status: 200, json: { ok: true } };
    }

    if (method !== 'GET') return null;

    // --- Read routes ---

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
      /** @type {Array<[string, (env: unknown, identity: unknown, reads: unknown) => Promise<unknown>]>} */
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
      const json = {};
      const readWarnings = [];
      settled.forEach((outcome, i) => {
        const [key] = readNames[i];
        if (outcome.status === 'fulfilled') {
          json[key] = outcome.value;
        } else {
          json[key] = [];
          readWarnings.push({ source: key, message: outcome.reason?.message || String(outcome.reason) });
        }
      });
      return { status: 200, json: { ...json, readWarnings } };
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
    return { status: 500, json: { error: err.message || 'flows route failed' } };
  }
}
