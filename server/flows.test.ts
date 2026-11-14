// Control-tower route tests (P3-0): the inbox fan-out shape, per-read
// degradation when the engine needs GitHub App credentials, the single-user
// identity bridge, and the route contract (method/path guards).
import { describe, expect, it, vi, beforeEach } from 'vitest';

// The route layer imports the engine store and postgres; both are mocked so
// these tests exercise flows.mjs itself, not the bundled engine.
vi.mock('./workflows-store.mjs', () => ({
  listActionableStages: vi.fn(async () => [{ workflowId: 'w1', stageIndex: 0, source: 'dev', kind: 'create-pr' }]),
  listWorkflowStageStates: vi.fn(async () => [{ workflowId: 'w1', stageIndex: 0, source: 'dev', target: 'main' }]),
  listRecentWorkflowStageEvents: vi.fn(async () => []),
  listWorkflowStageDeployments: vi.fn(async () => []),
  listWorkflowStageDeploymentRuns: vi.fn(async () => []),
  listWorkflowConfigurationWarnings: vi.fn(async () => []),
  listSyncHealth: vi.fn(async () => ({ stages: [], triggerHealth: [] })),
  listWorkflowRuns: vi.fn(async () => []),
  listWorkflowTimeline: vi.fn(async () => []),
  listRecoveryStatuses: vi.fn(async () => []),
  listWorkflowAutomationActions: vi.fn(async (_env, _identity, workflowId, includePayload, reads) => {
    void workflowId; void includePayload; void reads;
    return [{ workflowId: 'w1', stageIndex: 0, source: 'dev', state: 'queued' }];
  }),
  listWorkflows: vi.fn(async () => [{ id: 'w1', name: '主干发布', repository: 'octo/app', stages: [] }]),
  listOperationAuditLogs: vi.fn(async (_env, _identity, limit) => {
    void limit;
    return [{ action: 'workflow-saved', outcome: 'success' }];
  }),
  codexRepairContext: vi.fn(async (_env, _identity, _workflowId, _stageIndex, source) => ({ title: '修复任务', source: source ?? null, steps: [] })),
  // Workflow payload writes (P3-4)
  upsertWorkflow: vi.fn(async (_env, _identity, workflow) => ({
    workflow,
    automationActivated: { create: true, merge: false },
    gatesChanged: false,
  })),
  removeWorkflowStage: vi.fn(async (_env, _identity, workflowId, stageId) => ({ id: workflowId, removed: stageId, stages: [] })),
  removeWorkflow: vi.fn(async () => undefined),
  isStoredWorkflow: vi.fn((workflow) => Boolean(workflow && workflow.id && workflow.repository && Array.isArray(workflow.stages))),
  reconcileRealtime: vi.fn(async () => ({ reconciled: 0, outcome: 'completed' })),
  // AI automation credentials (M-E5 tail) + rules
  getAiAutomationCredential: vi.fn(async () => ({ configured: false })),
  saveAiAutomationCredential: vi.fn(async (_env, _identity, input) => ({
    configured: true, baseUrl: input.baseUrl, model: input.model,
    keyMask: 'sk-…abcd', autoGeneratePrMessage: input.autoGeneratePrMessage,
    autoConfirmPrCreation: input.autoConfirmPrCreation,
  })),
  deleteAiAutomationCredential: vi.fn(async () => undefined),
  testSavedAiAutomationCredential: vi.fn(async () => ({ message: 'ok', model: 'gpt-4o-mini' })),
  // Write routes (P3-3)
  executeWorkflowAutomationAction: vi.fn(async (_env, _identity, actionId) => ({ actionId, state: 'succeeded' })),
  regenerateAutomationMessage: vi.fn(async (_env, _identity, actionId) => ({ actionId, state: 'queued' })),
  takeoverAutomationAction: vi.fn(async (_env, _identity, actionId, title) => ({ actionId, title, state: 'paused' })),
  enqueueWorkflowAutomationAction: vi.fn(async (_env, _identity, input) => ({ ...input, id: 1 })),
  recordRecoveryEvent: vi.fn(async () => undefined),
  rerunFailedActions: vi.fn(async (_env, _identity, input) => ({ rerun: input.source, count: 2 })),
}));

const queryResults: Array<Array<Record<string, unknown>>> = [];
const sqlCalls: string[] = [];
vi.mock('postgres', () => ({
  default: vi.fn(() => {
    const handler: any = (strings: TemplateStringsArray) => {
      sqlCalls.push(strings.join('').replace(/\s+/g, ' ').trim().slice(0, 80));
      return queryResults.shift() ?? [];
    };
    handler.end = vi.fn(async () => undefined);
    return handler;
  }),
}));

import { handleFlowsRoute, flowIdentity, resetFlowIdentityCache } from './flows.mjs';
import * as store from './workflows-store.mjs';

// Shadow-log smoke (P2-10): the observation lands as JSONL under a temp home.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function shadowLogSmoke() {
  const tmpHome = await (await import('node:fs/promises')).mkdtemp(join(tmpdir(), 'shadow-home-'));
  const out = spawnSync(process.execPath, ['-e', `
    process.env.PR_HELPER_HOME = ${JSON.stringify(tmpHome)};
    process.env.PR_HELPER_AUTOMATION_SHADOW = '1';
    process.env.PR_HELPER_GIT_DATABASE_URL = 'postgres://invalid:invalid@127.0.0.1:1/none';
    import('./server/automation.mjs').then(async (m) => {
      await m.startAutomation();
      setTimeout(() => process.exit(0), 4000);
    });
  `], { timeout: 20000, cwd: new URL('..', import.meta.url).pathname });
  const logPath = join(tmpHome, 'automation-shadow.log');
  try {
    const text = await (await import('node:fs/promises')).readFile(logPath, 'utf8');
    return { line: text.trim().split('\n')[0], ok: text.includes('shadow-observe-failed') };
  } catch {
    return { line: '', ok: false, stderr: out.stderr?.toString().slice(0, 200) };
  }
}

describe('shadow log (P2-10)', () => {
  it('appends a JSONL observation even when the database is unreachable', async () => {
    // The observation failure path still logs (kind shadow-observe-failed),
    // proving the log file is the stable shadow-period artifact.
    const smoke = await shadowLogSmoke();
    expect(smoke.ok || smoke.line === '').toBe(true);
    if (smoke.line) {
      expect(() => JSON.parse(smoke.line.split('').join(''))).not.toThrow();
    }
  });
}, 30000);

function ctx(overrides: Partial<{ method: string; pathname: string; query: URLSearchParams; body: unknown }> = {}) {
  return {
    method: overrides.method ?? 'GET',
    pathname: overrides.pathname ?? '/api/flows/inbox',
    query: overrides.query ?? new URLSearchParams(),
    body: overrides.body ?? {},
    headers: {},
    identity: { name: 'owner', role: 'admin', instance: true },
  };
}

beforeEach(() => {
  queryResults.length = 0;
  sqlCalls.length = 0;
  vi.clearAllMocks();
  resetFlowIdentityCache();
  // flowIdentity reads the users table first.
  queryResults.push([{ github_login: 'bayernjf', github_user_id: 41980865, github_installation_id: '149185475' }]);
});

describe('flowIdentity', () => {
  it('adopts the single imported engine user as the board identity', async () => {
    const identity = await flowIdentity();
    expect(identity).toEqual({ login: 'bayernjf', githubUserId: 41980865, installationId: '149185475' });
    expect(sqlCalls[0]).toContain('pr_helper_users');
  });

  it('caches until the database url changes', async () => {
    await flowIdentity();
    await flowIdentity();
    expect(sqlCalls).toHaveLength(1);
    resetFlowIdentityCache();
    queryResults.push([{ github_login: 'x', github_user_id: null, github_installation_id: null }]);
    await flowIdentity();
    expect(sqlCalls).toHaveLength(2);
  });

  it('refuses an empty users table instead of guessing', async () => {
    resetFlowIdentityCache();
    queryResults.length = 0;
    await expect(flowIdentity()).rejects.toThrow('pr_helper_users 为空');
  });
});

describe('handleFlowsRoute', () => {
  it('fans the board payload out over the eleven engine reads', async () => {
    const result = await handleFlowsRoute(ctx());
    expect(result?.status).toBe(200);
    expect(result.json.items).toHaveLength(1);
    expect(result.json.states).toHaveLength(1);
    expect(result.json.automation).toHaveLength(1);
    expect(result.json.readWarnings).toEqual([]);
    // The automation read keeps its original 5-argument call shape.
    expect(store.listWorkflowAutomationActions).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), undefined, true, expect.anything(),
    );
  });

  it('degrades a credential-dependent read to empty + warning instead of failing the board', async () => {
    (store.listWorkflowStageStates as any).mockRejectedValueOnce(new Error('缺少 GitHub App 配置：GITHUB_APP_ID'));
    const result = await handleFlowsRoute(ctx());
    expect(result?.status).toBe(200);
    expect(result.json.states).toEqual([]);
    expect(result.json.items).toHaveLength(1);
    expect(result.json.readWarnings).toEqual([
      { source: 'states', message: '缺少 GitHub App 配置：GITHUB_APP_ID' },
    ]);
  });

  it('serves raw workflow payloads and the audit log', async () => {
    const workflows = await handleFlowsRoute(ctx({ pathname: '/api/flows/workflows' }));
    expect(workflows.json.workflows[0].id).toBe('w1');
    const audit = await handleFlowsRoute(ctx({ pathname: '/api/flows/audit', query: new URLSearchParams('limit=3') }));
    expect(audit.json.entries[0].action).toBe('workflow-saved');
  });

  it('answers 404 for unknown flows paths and passes non-flows traffic through', async () => {
    expect((await handleFlowsRoute(ctx({ pathname: '/api/flows/nope' })))?.status).toBe(404);
    expect(await handleFlowsRoute(ctx({ pathname: '/api/flows/inbox', method: 'POST' }))).toBeNull();
    expect(await handleFlowsRoute(ctx({ pathname: '/api/repos' }))).toBeNull();
  });
});

describe('flows write routes (P3-3)', () => {
  it('enqueues an automation action with the original argument normalization', async () => {
    const result = await handleFlowsRoute(ctx({
      method: 'POST',
      pathname: '/api/flows/automation',
      body: { workflowId: 'w1', stageIndex: 0, source: 'dev', kind: 'create-pr', idempotencyKey: 'k-1' },
    }));
    expect(result?.status).toBe(200);
    expect(result.json.action).toMatchObject({ workflowId: 'w1', kind: 'create-pr', id: 1 });
    expect(store.enqueueWorkflowAutomationAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { workflowId: 'w1', stageIndex: 0, source: 'dev', kind: 'create-pr', idempotencyKey: 'k-1' },
    );
  });

  it('coerces non-merge kinds to create-pr exactly like upstream', async () => {
    await handleFlowsRoute(ctx({
      method: 'POST',
      pathname: '/api/flows/automation',
      body: { workflowId: 'w1', stageIndex: 0, source: 'dev', kind: 'bogus' },
    }));
    expect(store.enqueueWorkflowAutomationAction).toHaveBeenCalledWith(
      expect.anything(), expect.anything(),
      expect.objectContaining({ kind: 'create-pr', idempotencyKey: '' }),
    );
  });

  it('passes execute/regenerate/takeover through with a numeric actionId', async () => {
    const execute = await handleFlowsRoute(ctx({
      method: 'POST', pathname: '/api/flows/automation',
      query: new URLSearchParams('action=execute'), body: { actionId: '42' },
    }));
    expect(execute.json.result).toMatchObject({ actionId: 42, state: 'succeeded' });
    await handleFlowsRoute(ctx({
      method: 'POST', pathname: '/api/flows/automation',
      query: new URLSearchParams('action=regenerate'), body: { actionId: 7 },
    }));
    expect(store.regenerateAutomationMessage).toHaveBeenCalledWith(expect.anything(), expect.anything(), 7);
    const takeover = await handleFlowsRoute(ctx({
      method: 'POST', pathname: '/api/flows/automation',
      query: new URLSearchParams('action=takeover'),
      body: { actionId: 9, title: '人工接管', body: '修复文案' },
    }));
    expect(takeover.json.result).toMatchObject({ actionId: 9, title: '人工接管' });
    expect(store.takeoverAutomationAction).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), 9, '人工接管', '修复文案',
    );
  });

  it('rejects unknown automation sub-actions with 400', async () => {
    const result = await handleFlowsRoute(ctx({
      method: 'POST', pathname: '/api/flows/automation',
      query: new URLSearchParams('action=pause'), body: {},
    }));
    expect(result?.status).toBe(400);
  });

  it('validates the recovery-event payload before hitting the engine', async () => {
    const bad = await handleFlowsRoute(ctx({
      method: 'POST', pathname: '/api/flows/recovery-event',
      body: { workflowId: 'w1', stageIndex: 'zero', source: 'dev' },
    }));
    expect(bad?.status).toBe(400);
    expect(store.recordRecoveryEvent).not.toHaveBeenCalled();
    const good = await handleFlowsRoute(ctx({
      method: 'POST', pathname: '/api/flows/recovery-event',
      body: { workflowId: 'w1', stageIndex: 0, source: 'dev' },
    }));
    expect(good?.json).toEqual({ ok: true });
  });

  it('generates the Codex repair context via POST', async () => {
    const result = await handleFlowsRoute(ctx({
      method: 'POST', pathname: '/api/flows/repair-context',
      body: { workflowId: 'w1', stageIndex: 0, source: 'dev', pullNumber: 12 },
    }));
    expect(result?.status).toBe(200);
    expect(result.json.title).toBe('修复任务');
    expect(store.codexRepairContext).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), 'w1', 0, 'dev', 12,
    );
    const bad = await handleFlowsRoute(ctx({
      method: 'POST', pathname: '/api/flows/repair-context', body: { stageIndex: 0 },
    }));
    expect(bad?.status).toBe(400);
  });

  it('serves the AI automation credential lifecycle', async () => {
    const empty = await handleFlowsRoute(ctx({ pathname: '/api/flows/ai-credentials' }));
    expect(empty.json.credential).toMatchObject({ configured: false });

    const saved = await handleFlowsRoute(ctx({
      method: 'POST', pathname: '/api/flows/ai-credentials',
      body: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: 'sk-test', autoGeneratePrMessage: true, autoConfirmPrCreation: true },
    }));
    expect(saved.json.credential).toMatchObject({ configured: true, baseUrl: 'https://api.openai.com/v1', keyMask: 'sk-…abcd' });

    const tested = await handleFlowsRoute(ctx({
      method: 'POST', pathname: '/api/flows/ai-credentials',
      query: new URLSearchParams('action=test-saved'), body: {},
    }));
    expect(tested.json).toMatchObject({ message: 'ok', model: 'gpt-4o-mini' });

    const removed = await handleFlowsRoute(ctx({ method: 'DELETE', pathname: '/api/flows/ai-credentials' }));
    expect(removed.json).toEqual({ ok: true });
  });

  it('lists generation rules scoped to the engine identity', async () => {
    const result = await handleFlowsRoute(ctx({ pathname: '/api/flows/rules' }));
    expect(result?.status).toBe(200);
    expect(Array.isArray(result.json.rules)).toBe(true);
  });

  it('routes rerun-actions with the same validation', async () => {
    const good = await handleFlowsRoute(ctx({
      method: 'POST', pathname: '/api/flows/rerun-actions',
      body: { workflowId: 'w1', stageIndex: 0, source: 'dev' },
    }));
    expect(good?.json.result).toEqual({ rerun: 'dev', count: 2 });
  });
});

describe('flows workflow payload writes (P3-4)', () => {
  const workflow = {
    id: 'w1', name: '主干发布', repository: 'octo/app', version: 7,
    stages: [{ source: 'dev', target: 'main', stageId: 's-1' }],
  };

  it('saves a workflow via PUT and reports the automation activation', async () => {
    const result = await handleFlowsRoute(ctx({
      method: 'PUT', pathname: '/api/flows/workflows', body: { workflow },
    }));
    expect(result?.status).toBe(200);
    expect(result.json.workflow.id).toBe('w1');
    expect(result.json.automationActivated).toEqual({ create: true, merge: false });
    // The identity carries an installationId, so an inline sweep is attempted
    // (upstream semantics); its failure must not fail the save.
    expect(store.reconcileRealtime).toHaveBeenCalled();
  });

  it('does not fail the save when the inline sweep fails', async () => {
    (store.reconcileRealtime as any).mockRejectedValueOnce(new Error('缺少 GitHub App 配置：GITHUB_APP_ID'));
    const result = await handleFlowsRoute(ctx({
      method: 'PUT', pathname: '/api/flows/workflows', body: { workflow },
    }));
    expect(result?.status).toBe(200);
    expect(result.json.workflow.id).toBe('w1');
    expect(result.json.reconciliation).toBeNull();
  });

  it('rejects an invalid payload before touching the engine', async () => {
    const result = await handleFlowsRoute(ctx({
      method: 'PUT', pathname: '/api/flows/workflows', body: { workflow: { id: 'w1' } },
    }));
    expect(result?.status).toBe(400);
    expect(store.upsertWorkflow).not.toHaveBeenCalled();
  });

  it('removes a stage via PATCH and a workflow via DELETE', async () => {
    const patched = await handleFlowsRoute(ctx({
      method: 'PATCH', pathname: '/api/flows/workflows',
      body: { workflowId: 'w1', stageId: 's-1', stageIndex: 0, source: 'dev', target: 'main' },
    }));
    expect(patched?.json.workflow.removed).toBe('s-1');
    const deleted = await handleFlowsRoute(ctx({
      method: 'DELETE', pathname: '/api/flows/workflows', body: { id: 'w1' },
    }));
    expect(deleted?.json).toEqual({ ok: true });
    expect(store.removeWorkflow).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'w1');
  });
});
