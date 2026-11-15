import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  config: /** @type {any} */ ({}),
  audits: /** @type {any[]} */ ([]),
}));

vi.mock('./store.mjs', () => ({
  loadConfig: vi.fn(async () => structuredClone(state.config)),
  updateConfig: vi.fn(async (mutator) => {
    const config = structuredClone(state.config);
    const outcome = await mutator(config);
    state.config = config;
    return outcome;
  }),
  appendAudit: vi.fn(async (entry) => {
    state.audits.push(entry);
  }),
}));

vi.mock('./flows.mjs', () => ({
  engineContext: vi.fn(async () => ({
    identity: { login: 'octocat', githubUserId: 1 },
    env: { DATABASE_URL: 'postgres://test' },
  })),
}));

vi.mock('./workflows-store.mjs', () => ({
  enqueueWorkflowAutomationAction: vi.fn(async (_env, _identity, input) => ({ id: 42, runId: 7, ...input })),
  rerunFailedActions: vi.fn(async (_env, _identity, input) => ({ source: input.source, count: 2 })),
  listWorkflows: vi.fn(async () => [
    { id: 'w1', name: 'Main release', repository: 'octo/app', archived: false, stages: [{}, {}] },
    { id: 'w2', name: 'Other', repository: 'octo/other', archived: false, stages: [{}] },
  ]),
  listWorkflowStageDeployments: vi.fn(async () => [
    { workflowId: 'w1', stageIndex: 0, source: 'dev', provider: 'vercel', environment: 'production', state: 'success', healthState: 'success' },
    { workflowId: 'w2', stageIndex: 0, source: 'dev', provider: 'vercel', environment: 'production', state: 'success', healthState: 'success' },
  ]),
  listWorkflowStageDeploymentRuns: vi.fn(async () => [
    { workflowId: 'w1', stageIndex: 0, source: 'dev', provider: 'vercel', state: 'success' },
  ]),
}));

import * as store from './workflows-store.mjs';
import {
  buildAgentCard,
  evaluateA2aAccess,
  handleA2aAdminRoute,
  handleA2aPublicRoute,
  isA2aPublicPath,
} from './a2a.mjs';

const TOKEN = 'a2a-secret';
const ENV = { PR_HELPER_GIT_A2A_TOKEN: TOKEN };
const HEADERS = { host: '127.0.0.1:4789', authorization: `Bearer ${TOKEN}` };

function rpc(method, params, id = 1) {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params });
}

function message(skill, skillParams) {
  return {
    role: 'user',
    parts: [{ kind: 'data', data: { skill, ...skillParams } }],
  };
}

beforeEach(() => {
  state.config = {};
  state.audits = [];
  vi.mocked(store.enqueueWorkflowAutomationAction).mockClear();
  vi.mocked(store.rerunFailedActions).mockClear();
});

describe('agent card', () => {
  it('serves the card without a token and derives the URL from the Host header', async () => {
    const result = await handleA2aPublicRoute({
      method: 'GET',
      pathname: '/api/a2a/agent-card',
      headers: { host: '127.0.0.1:4789' },
      rawBody: '',
      env: {},
    });
    expect(result.status).toBe(200);
    expect(result.headers['access-control-allow-origin']).toBe('*');
    expect(result.json.name).toBe('pr-helper-git');
    expect(result.json.url).toBe('http://127.0.0.1:4789/api/a2a/agent-card');
    expect(result.json.skills).toHaveLength(5);
    expect(JSON.stringify(result.json)).not.toContain(TOKEN);
  });

  it('serves the well-known aliases', async () => {
    for (const pathname of ['/.well-known/agent-card.json', '/.well-known/agent.json']) {
      expect(isA2aPublicPath(pathname)).toBe(true);
      const result = await handleA2aPublicRoute({ method: 'GET', pathname, headers: HEADERS, rawBody: '', env: ENV });
      expect(result.status).toBe(200);
    }
  });

  it('builds the same shape from buildAgentCard', () => {
    expect(buildAgentCard({ url: 'http://x/api/a2a/agent-card' })).toMatchObject({
      name: 'pr-helper-git',
      authentication: { schemes: ['bearer'] },
      preferredTransport: 'JSONRPC',
    });
  });
});

describe('access decision', () => {
  it('is fail-closed and allows the loopback anonymous escape hatch only when enabled', () => {
    expect(evaluateA2aAccess({ presentedToken: undefined, expectedToken: '', allowAnonymous: false })).toBe('unconfigured');
    expect(evaluateA2aAccess({ presentedToken: undefined, expectedToken: '', allowAnonymous: true })).toBe('allow');
    expect(evaluateA2aAccess({ presentedToken: 'wrong', expectedToken: TOKEN, allowAnonymous: false })).toBe('unauthorized');
    expect(evaluateA2aAccess({ presentedToken: TOKEN, expectedToken: TOKEN, allowAnonymous: false })).toBe('allow');
  });
});

describe('JSON-RPC', () => {
  it('returns 503 when no token is configured', async () => {
    const result = await handleA2aPublicRoute({
      method: 'POST',
      pathname: '/api/a2a/agent-card',
      headers: HEADERS,
      rawBody: rpc('tasks/send', {}),
      env: {},
    });
    expect(result.status).toBe(503);
  });

  it('returns 401 for a wrong bearer token', async () => {
    const result = await handleA2aPublicRoute({
      method: 'POST',
      pathname: '/api/a2a/agent-card',
      headers: { host: '127.0.0.1:4789', authorization: 'Bearer nope' },
      rawBody: rpc('tasks/send', {}),
      env: ENV,
    });
    expect(result.status).toBe(401);
    expect(result.headers['www-authenticate']).toBe('Bearer');
  });

  it('rejects invalid JSON and unknown methods', async () => {
    const bad = await handleA2aPublicRoute({
      method: 'POST', pathname: '/api/a2a/agent-card', headers: HEADERS, rawBody: '{', env: ENV,
    });
    expect(bad.status).toBe(400);
    expect(bad.json.error.code).toBe(-32700);

    const unknown = await handleA2aPublicRoute({
      method: 'POST', pathname: '/api/a2a/agent-card', headers: HEADERS,
      rawBody: rpc('tasks/nope', {}), env: ENV,
    });
    expect(unknown.json.error.code).toBe(-32601);
  });

  it('runs create-pr in plan mode without touching the engine', async () => {
    const result = await handleA2aPublicRoute({
      method: 'POST',
      pathname: '/api/a2a/agent-card',
      headers: HEADERS,
      rawBody: rpc('tasks/send', { message: message('create-pr', { owner: 'octo', repo: 'app', head: 'dev', base: 'main' }) }),
      env: ENV,
    });
    expect(result.status).toBe(200);
    expect(result.json.result.status.state).toBe('completed');
    expect(result.json.result.artifacts[0].parts[0].data.mode).toBe('plan');
    expect(store.enqueueWorkflowAutomationAction).not.toHaveBeenCalled();
    expect(state.audits.at(-1)).toMatchObject({ action: 'a2a.execute', skill: 'create-pr', mode: 'plan' });
  });

  it('enqueues create-pr in execute mode with the workflow stage context', async () => {
    const result = await handleA2aPublicRoute({
      method: 'POST',
      pathname: '/api/a2a/agent-card',
      headers: HEADERS,
      rawBody: rpc('tasks/send', {
        message: message('create-pr', {
          owner: 'octo', repo: 'app', head: 'dev', base: 'main',
          workflowId: 'w1', stageIndex: 0, source: 'dev', mode: 'execute',
        }),
      }),
      env: ENV,
    });
    expect(result.json.result.status.state).toBe('completed');
    expect(store.enqueueWorkflowAutomationAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ workflowId: 'w1', stageIndex: 0, source: 'dev', kind: 'create-pr' }),
    );
    expect(vi.mocked(store.enqueueWorkflowAutomationAction).mock.calls[0][2].idempotencyKey).toContain('a2a:create-pr:');
    expect(state.audits.at(-1)).toMatchObject({ action: 'a2a.execute', mode: 'execute' });
  });

  it('does not require plan-only repository parameters in execute mode', async () => {
    const result = await handleA2aPublicRoute({
      method: 'POST',
      pathname: '/api/a2a/agent-card',
      headers: HEADERS,
      rawBody: rpc('tasks/send', {
        message: message('create-pr', { workflowId: 'w1', stageIndex: 0, source: 'dev', mode: 'execute' }),
      }),
      env: ENV,
    });
    expect(result.json.result.status.state).toBe('completed');
    expect(store.enqueueWorkflowAutomationAction).toHaveBeenCalled();
  });

  it('requires confirm=true before enqueueing a merge', async () => {
    const result = await handleA2aPublicRoute({
      method: 'POST',
      pathname: '/api/a2a/agent-card',
      headers: HEADERS,
      rawBody: rpc('tasks/send', {
        message: message('merge-pr', {
          owner: 'octo', repo: 'app', number: 3,
          workflowId: 'w1', stageIndex: 0, source: 'dev', mode: 'execute',
        }),
      }),
      env: ENV,
    });
    expect(result.json.result.status.state).toBe('input-required');
    expect(store.enqueueWorkflowAutomationAction).not.toHaveBeenCalled();
  });

  it('enqueues a merge when confirm=true', async () => {
    const result = await handleA2aPublicRoute({
      method: 'POST',
      pathname: '/api/a2a/agent-card',
      headers: HEADERS,
      rawBody: rpc('tasks/send', {
        message: message('merge-pr', {
          owner: 'octo', repo: 'app', number: 3, confirm: true,
          workflowId: 'w1', stageIndex: 0, source: 'dev', mode: 'execute',
        }),
      }),
      env: ENV,
    });
    expect(result.json.result.status.state).toBe('completed');
    expect(store.enqueueWorkflowAutomationAction).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.objectContaining({ kind: 'merge-pr' }),
    );
  });

  it('calls the engine for rerun-actions in execute mode', async () => {
    const result = await handleA2aPublicRoute({
      method: 'POST',
      pathname: '/api/a2a/agent-card',
      headers: HEADERS,
      rawBody: rpc('tasks/send', {
        message: message('rerun-actions', {
          owner: 'octo', repo: 'app', runId: 9,
          workflowId: 'w1', stageIndex: 0, source: 'dev', mode: 'execute',
        }),
      }),
      env: ENV,
    });
    expect(result.json.result.status.state).toBe('completed');
    expect(store.rerunFailedActions).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), { workflowId: 'w1', stageIndex: 0, source: 'dev' },
    );
  });

  it('reads the local deployment projection', async () => {
    const result = await handleA2aPublicRoute({
      method: 'POST',
      pathname: '/api/a2a/agent-card',
      headers: HEADERS,
      rawBody: rpc('tasks/send', {
        message: message('deployment-health', { repository: 'octo/app', mode: 'execute' }),
      }),
      env: ENV,
    });
    const data = result.json.result.artifacts[0].parts[0].data;
    expect(result.json.result.status.state).toBe('completed');
    expect(data.workflows).toHaveLength(1);
    expect(data.deployments).toHaveLength(1);
    expect(data.deployments[0].workflowId).toBe('w1');
  });

  it('always escalates a production rollback instead of dispatching it', async () => {
    const result = await handleA2aPublicRoute({
      method: 'POST',
      pathname: '/api/a2a/agent-card',
      headers: HEADERS,
      rawBody: rpc('tasks/send', {
        message: message('production-rollback', { owner: 'octo', repo: 'app', environment: 'production', mode: 'execute' }),
      }),
      env: ENV,
    });
    expect(result.json.result.status.state).toBe('input-required');
    expect(store.enqueueWorkflowAutomationAction).not.toHaveBeenCalled();
    expect(store.rerunFailedActions).not.toHaveBeenCalled();
  });

  it('supports tasks/get and tasks/cancel', async () => {
    const sent = await handleA2aPublicRoute({
      method: 'POST',
      pathname: '/api/a2a/agent-card',
      headers: HEADERS,
      rawBody: rpc('tasks/send', {
        message: message('merge-pr', {
          owner: 'octo', repo: 'app', number: 3,
          workflowId: 'w1', stageIndex: 0, source: 'dev', mode: 'execute',
        }),
      }),
      env: ENV,
    });
    const id = sent.json.result.id;
    expect(sent.json.result.status.state).toBe('input-required');

    const got = await handleA2aPublicRoute({
      method: 'POST', pathname: '/api/a2a/agent-card', headers: HEADERS,
      rawBody: rpc('tasks/get', { id }), env: ENV,
    });
    expect(got.json.result.id).toBe(id);

    const canceled = await handleA2aPublicRoute({
      method: 'POST', pathname: '/api/a2a/agent-card', headers: HEADERS,
      rawBody: rpc('tasks/cancel', { id }), env: ENV,
    });
    expect(canceled.json.result.status.state).toBe('canceled');
  });

  it('streams tasks/sendSubscribe as SSE', async () => {
    const result = await handleA2aPublicRoute({
      method: 'POST',
      pathname: '/api/a2a/agent-card',
      headers: HEADERS,
      rawBody: rpc('tasks/sendSubscribe', {
        message: message('create-pr', { owner: 'octo', repo: 'app', head: 'dev', base: 'main' }),
      }),
      env: ENV,
    });
    expect(result.contentType).toBe('text/event-stream');
    expect(result.raw).toContain('data: ');
    expect(result.raw).toContain('"status-update"');
  });
});

describe('status route', () => {
  it('reports configuration, card URL and skills', async () => {
    const previous = process.env.PR_HELPER_GIT_A2A_TOKEN;
    process.env.PR_HELPER_GIT_A2A_TOKEN = TOKEN;
    try {
      const result = await handleA2aAdminRoute({
        method: 'GET',
        pathname: '/api/a2a/status',
        headers: { host: '127.0.0.1:4789' },
        identity: { role: 'admin' },
      });
      expect(result.status).toBe(200);
      expect(result.json).toMatchObject({
        configured: true,
        source: 'env',
        tokenEnv: 'PR_HELPER_GIT_A2A_TOKEN',
      });
      expect(result.json.skills).toHaveLength(5);
      expect(JSON.stringify(result.json)).not.toContain(TOKEN);
    } finally {
      if (previous === undefined) delete process.env.PR_HELPER_GIT_A2A_TOKEN;
      else process.env.PR_HELPER_GIT_A2A_TOKEN = previous;
    }
  });

  it('generates a config-backed token once and authenticates with it', async () => {
    const generated = await handleA2aAdminRoute({
      method: 'POST',
      pathname: '/api/a2a/token',
      headers: {},
      identity: { role: 'admin' },
    });
    expect(generated.status).toBe(200);
    expect(generated.json.token.length).toBeGreaterThan(20);
    expect(state.config.a2a.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(state.config.a2a.hint).toBe(generated.json.token.slice(-4));
    expect(state.audits.at(-1)).toMatchObject({ action: 'a2a.token.generate' });

    const status = await handleA2aAdminRoute({
      method: 'GET', pathname: '/api/a2a/status', headers: {}, identity: { role: 'admin' },
    });
    expect(status.json).toMatchObject({ configured: true, source: 'config', hint: state.config.a2a.hint });
    expect(JSON.stringify(status.json)).not.toContain(generated.json.token);

    const plan = await handleA2aPublicRoute({
      method: 'POST',
      pathname: '/api/a2a/agent-card',
      headers: { host: '127.0.0.1:4789', authorization: `Bearer ${generated.json.token}` },
      rawBody: rpc('tasks/send', { message: message('create-pr', { owner: 'octo', repo: 'app', head: 'dev', base: 'main' }) }),
      env: {},
    });
    expect(plan.status).toBe(200);
    expect(plan.json.result.status.state).toBe('completed');
  });

  it('lets only the owner generate or revoke the token', async () => {
    const denied = await handleA2aAdminRoute({
      method: 'POST', pathname: '/api/a2a/token', headers: {}, identity: { role: 'member' },
    });
    expect(denied.status).toBe(403);

    await handleA2aAdminRoute({ method: 'POST', pathname: '/api/a2a/token', headers: {}, identity: { role: 'admin' } });
    const revoked = await handleA2aAdminRoute({
      method: 'DELETE', pathname: '/api/a2a/token', headers: {}, identity: { role: 'admin' },
    });
    expect(revoked.json).toMatchObject({ ok: true, configured: false, source: null });
    expect(state.config.a2a).toBeUndefined();

    const rpcAfter = await handleA2aPublicRoute({
      method: 'POST', pathname: '/api/a2a/agent-card', headers: HEADERS,
      rawBody: rpc('tasks/send', {}), env: {},
    });
    expect(rpcAfter.status).toBe(503);
  });
});
