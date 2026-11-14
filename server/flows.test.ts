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

function ctx(overrides: Partial<{ method: string; pathname: string; query: URLSearchParams }> = {}) {
  return {
    method: overrides.method ?? 'GET',
    pathname: overrides.pathname ?? '/api/flows/inbox',
    query: overrides.query ?? new URLSearchParams(),
    body: {},
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
