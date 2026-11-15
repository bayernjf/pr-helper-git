// A2A / Agent Card surface.
//
// GET serves the public Agent Card; POST is a JSON-RPC 2.0 task endpoint. The
// route sits before the local token guard (like the GitHub webhook) because
// A2A callers authenticate with their own bearer token. Plan mode is the
// default; execute mode is wired to the real automation engine:
//   - create-pr / merge-pr enqueue an engine action (the drainer executes it)
//   - rerun-actions calls the engine directly
//   - deployment-health reads the local projection only
//   - production-rollback always escalates to the operator
//
// Task storage is in memory (30 min TTL, 500 tasks); tasks/get after a restart
// is best-effort, matching the original product.

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { appendAudit, loadConfig, updateConfig } from './store.mjs';
import { runAsActor } from './actor.mjs';
import { fail, ok } from './http.mjs';
import { engineContext } from './flows.mjs';
import * as store from './workflows-store.mjs';

const CARD_PATH = '/api/a2a/agent-card';
const CARD_ALIASES = ['/.well-known/agent-card.json', '/.well-known/agent.json'];
const PUBLIC_PATHS = new Set([CARD_PATH, ...CARD_ALIASES]);
const STATUS_PATH = '/api/a2a/status';
const TOKEN_PATH = '/api/a2a/token';
const CARD_VERSION = '0.1.0';
const TASK_TTL_MS = 30 * 60_000;
const MAX_TASKS = 500;
const A2A_ACTOR = { name: 'a2a', role: 'admin', instance: false };

const JSONRPC_ERRORS = {
  PARSE: { code: -32700, message: 'Parse error' },
  INVALID_REQUEST: { code: -32600, message: 'Invalid Request' },
  METHOD_NOT_FOUND: { code: -32601, message: 'Method not found' },
  INVALID_PARAMS: { code: -32602, message: 'Invalid params' },
  INTERNAL: { code: -32603, message: 'Internal error' },
  TASK_NOT_FOUND: { code: -32001, message: 'Task not found' },
  TASK_NOT_CANCELABLE: { code: -32002, message: 'Task not cancelable' },
};

const TERMINAL_STATES = ['completed', 'failed', 'canceled'];

const SKILLS = [
  {
    id: 'create-pr',
    name: 'Create pull request',
    description: 'Draft and open a pull request on a target repository. Execute mode enqueues the engine automation action for the matching workflow stage.',
    tags: ['github', 'pull-request', 'draft'],
  },
  {
    id: 'merge-pr',
    name: 'Merge pull request',
    description: 'Merge a pull request once predecessor gates and checks have succeeded. Execute mode requires confirm=true and enqueues the engine action.',
    tags: ['github', 'merge', 'gate'],
  },
  {
    id: 'rerun-actions',
    name: 'Rerun GitHub Actions',
    description: 'Trigger a rerun of failed GitHub Actions workflow runs for a workflow stage.',
    tags: ['github', 'actions', 'ci'],
  },
  {
    id: 'deployment-health',
    name: 'Track deployments and run health checks',
    description: 'Read the local deployment projection and report stage health with recent runs.',
    tags: ['github', 'deployments', 'health', 'audit'],
  },
  {
    id: 'production-rollback',
    name: 'Trigger confirmed Production rollback',
    description: 'Irreversible: execute mode always escalates to the operator instead of dispatching the rollback.',
    tags: ['github', 'rollback', 'production', 'irreversible'],
  },
];

export function skillIds() {
  return SKILLS.map((skill) => skill.id);
}

/** @param {Record<string, string | string[] | undefined>} headers @param {string} name */
function header(headers, name) {
  const raw = headers?.[name] ?? headers?.[name.toLowerCase()];
  return Array.isArray(raw) ? raw[0] : raw;
}

/** @param {Record<string, string | string[] | undefined>} headers */
function bearerToken(headers) {
  return (header(headers, 'authorization') || '').replace(/^Bearer\s+/i, '') || undefined;
}

function cardUrl(headers) {
  const host = header(headers, 'x-forwarded-host') || header(headers, 'host') || '127.0.0.1:4789';
  const forwarded = header(headers, 'x-forwarded-proto');
  const proto = forwarded === 'https' ? 'https' : 'http';
  return `${proto}://${host}${CARD_PATH}`;
}

export function buildAgentCard({ url }) {
  return {
    name: 'pr-helper-git',
    description:
      'Local-first GitHub PR / release control tower: create and merge pull requests, rerun Actions, track deployments, run health checks, and trigger confirmed Production rollbacks across repository lanes.',
    url,
    version: CARD_VERSION,
    provider: { organization: 'bayjf', url: 'https://github.com/bayernjf/pr-helper-git' },
    capabilities: { streaming: true, pushNotifications: false, stateTransitionHistory: true },
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    skills: SKILLS,
    authentication: { schemes: ['bearer'] },
    preferredTransport: 'JSONRPC',
    'x-zeus-handshake': {
      version: '1',
      registeredTo: 'zeus',
      domain: 'pr-release-control',
      dataDomains: ['enterprise'],
      dataPolicy: 'read-task-scope',
      reportBack: true,
      escalationPolicy: 'auto',
      sla: { ackSeconds: 5 },
      notes:
        'Task execution lives at POST /api/a2a/agent-card (JSON-RPC: tasks/send, tasks/sendSubscribe, tasks/get, tasks/cancel). Plan mode is the default; execute mode enqueues real local automation actions and production rollback always escalates to the operator. Bearer token: PR_HELPER_GIT_A2A_TOKEN (legacy ZEUS_A2A_TOKEN). Task storage is in-memory per server process.',
    },
  };
}

/** @param {string | undefined} presented @param {string} expected */
function bearerMatches(presented, expected) {
  if (!presented) return false;
  const left = createHash('sha256').update(presented).digest();
  const right = createHash('sha256').update(expected).digest();
  return timingSafeEqual(left, right);
}

export function isLoopbackBinding(env = process.env) {
  const host = String(env.PR_HELPER_GIT_HOST ?? env.GIT2_HOST ?? '127.0.0.1').toLowerCase();
  return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host);
}

export function a2aConfig(env = process.env) {
  const token = String(env.PR_HELPER_GIT_A2A_TOKEN ?? env.ZEUS_A2A_TOKEN ?? '').trim();
  return {
    configured: Boolean(token),
    token,
    allowAnonymous: env.PR_HELPER_GIT_A2A_ALLOW_INSECURE_ANONYMOUS === '1' && isLoopbackBinding(env),
  };
}

export function hashToken(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

/** Token generated from the settings UI: only its hash is persisted. */
export async function readStoredA2aToken() {
  const config = await loadConfig();
  const stored = config && typeof config === 'object' ? config.a2a : null;
  if (!stored || typeof stored.tokenHash !== 'string' || !/^[a-f0-9]{64}$/i.test(stored.tokenHash)) return null;
  return {
    tokenHash: stored.tokenHash,
    hint: typeof stored.hint === 'string' ? stored.hint : '',
    createdAt: typeof stored.createdAt === 'string' ? stored.createdAt : null,
  };
}

/**
 * Effective A2A authentication: an env token wins (it cannot be revoked from
 * the UI), otherwise the stored hash from config.json is used.
 */
export async function resolveA2aAuth(env = process.env) {
  const base = a2aConfig(env);
  if (base.token) return { ...base, source: 'env', tokenHash: null, hint: null, createdAt: null };
  const stored = await readStoredA2aToken();
  return {
    ...base,
    source: stored ? 'config' : null,
    tokenHash: stored?.tokenHash ?? null,
    hint: stored?.hint ?? null,
    createdAt: stored?.createdAt ?? null,
  };
}

export async function generateA2aToken() {
  const token = randomBytes(24).toString('base64url');
  const createdAt = new Date().toISOString();
  const hint = token.slice(-4);
  await updateConfig((config) => {
    config.a2a = { tokenHash: hashToken(token), hint, createdAt };
  });
  return { token, hint, createdAt };
}

export async function revokeA2aToken() {
  await updateConfig((config) => {
    if (config.a2a) delete config.a2a;
  });
}

/** @param {string} left @param {string} right */
function safeHashEquals(left, right) {
  if (typeof right !== 'string' || !/^[a-f0-9]{64}$/i.test(right)) return false;
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Fail-closed access decision: no configured token means 503 unless the
 * explicit loopback-only anonymous escape hatch is on. Accepts either a
 * plaintext env token or a stored SHA-256 hash.
 */
export function evaluateA2aAccess({ presentedToken, expectedToken, expectedTokenHash, allowAnonymous }) {
  if (expectedToken) return bearerMatches(presentedToken, expectedToken) ? 'allow' : 'unauthorized';
  if (expectedTokenHash) {
    if (!presentedToken) return 'unauthorized';
    return safeHashEquals(hashToken(presentedToken), expectedTokenHash) ? 'allow' : 'unauthorized';
  }
  return allowAnonymous ? 'allow' : 'unconfigured';
}

/* -------------------------------------------------------------------------- */
/* Task store                                                                  */
/* -------------------------------------------------------------------------- */

export function createTaskStore(now = () => new Date(), randomId = () => randomUUID()) {
  /** @type {Map<string, { task: any, expiresAt: number }>} */
  const tasks = new Map();

  function sweep() {
    const timestamp = now().getTime();
    for (const [id, entry] of tasks) {
      if (entry.expiresAt <= timestamp) tasks.delete(id);
    }
    while (tasks.size > MAX_TASKS) {
      const oldest = tasks.keys().next().value;
      if (oldest === undefined) break;
      tasks.delete(oldest);
    }
  }

  return {
    create(history, metadata) {
      sweep();
      const task = {
        kind: 'task',
        id: randomId(),
        contextId: randomId(),
        status: { state: 'submitted', timestamp: now().toISOString() },
        history: [...history],
        artifacts: [],
        metadata,
      };
      tasks.set(task.id, { task, expiresAt: now().getTime() + TASK_TTL_MS });
      return structuredClone(task);
    },
    get(id) {
      const entry = tasks.get(id);
      return entry ? structuredClone(entry.task) : undefined;
    },
    update(id, mutate) {
      const entry = tasks.get(id);
      if (!entry) throw new Error(`task not found: ${id}`);
      entry.task = mutate(structuredClone(entry.task));
      entry.expiresAt = now().getTime() + TASK_TTL_MS;
      return structuredClone(entry.task);
    },
  };
}

const taskStore = createTaskStore();

function setState(task, state, timestamp) {
  if (TERMINAL_STATES.includes(task.status.state)) return task;
  return { ...task, status: { state, timestamp } };
}

/* -------------------------------------------------------------------------- */
/* Skills                                                                      */
/* -------------------------------------------------------------------------- */

function planArtifact(name, params, steps) {
  return {
    name,
    parts: [
      { kind: 'data', data: { mode: 'plan', skill: name, params } },
      { kind: 'text', text: steps.map((step, index) => `${index + 1}. ${step}`).join('\n') },
    ],
    'x-zeus-report': {
      summary: `${name}: plan generated for ${String(params.repository ?? params.owner ?? params.workflowId ?? '?')}.`,
      evidence: [`parameters validated: ${Object.keys(params).join(', ')}`],
      cost: { llmTokens: 0, wallSeconds: 0 },
      followUps: [],
    },
  };
}

function executionArtifact(name, params, payload, summary) {
  return {
    name,
    parts: [
      { kind: 'data', data: { mode: 'execute', skill: name, params, ...payload } },
      { kind: 'text', text: summary },
    ],
    'x-zeus-report': {
      summary,
      evidence: [`executed via the local automation engine: ${Object.keys(payload).join(', ')}`],
      cost: { llmTokens: 0, wallSeconds: 0 },
      followUps: [],
    },
  };
}

function missingParams(required, params) {
  const missing = required.filter((key) => params[key] === undefined || params[key] === '');
  if (!missing.length) return null;
  return { state: 'input-required', message: `Missing required parameters: ${missing.join(', ')}.` };
}

function missingExecutionContext(params) {
  const missing = [];
  if (typeof params.workflowId !== 'string' || !params.workflowId) missing.push('workflowId');
  if (!Number.isInteger(params.stageIndex) || params.stageIndex < 0) missing.push('stageIndex');
  if (typeof params.source !== 'string' || !params.source) missing.push('source');
  if (!missing.length) return null;
  return {
    state: 'input-required',
    message: `Execute mode needs the local workflow stage context: ${missing.join(', ')}. Plan mode only needs repository parameters.`,
  };
}

async function engineEnqueue(kind, params) {
  const { identity, env } = await engineContext();
  const idempotencyKey = typeof params.idempotencyKey === 'string' && params.idempotencyKey
    ? params.idempotencyKey
    : `a2a:${kind}:${randomUUID()}`;
  const action = await store.enqueueWorkflowAutomationAction(env, identity, {
    workflowId: params.workflowId,
    stageIndex: params.stageIndex,
    source: params.source,
    kind,
    idempotencyKey,
  });
  return { action };
}

async function engineRerun(params) {
  const { identity, env } = await engineContext();
  const result = await store.rerunFailedActions(env, identity, {
    workflowId: params.workflowId,
    stageIndex: params.stageIndex,
    source: params.source,
  });
  return { result };
}

async function readDeploymentHealth(params) {
  const { identity, env } = await engineContext();
  const reads = {};
  const workflows = await store.listWorkflows(env, identity);
  const workflowIds = new Set(
    workflows
      .filter((workflow) => (
        (typeof params.workflowId === 'string' && params.workflowId ? workflow.id === params.workflowId : true)
        && (typeof params.repository === 'string' && params.repository ? workflow.repository === params.repository : true)
      ))
      .map((workflow) => workflow.id),
  );
  const [deployments, runs] = await Promise.all([
    store.listWorkflowStageDeployments(env, identity, reads),
    store.listWorkflowStageDeploymentRuns(env, identity, reads),
  ]);
  const workflowSummaries = workflows
    .filter((workflow) => workflowIds.has(workflow.id))
    .map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      repository: workflow.repository,
      archived: Boolean(workflow.archived),
      stages: Array.isArray(workflow.stages) ? workflow.stages.length : 0,
    }));
  return {
    workflows: workflowSummaries,
    deployments: deployments.filter((row) => workflowIds.has(row.workflowId)).slice(0, 200),
    runs: runs.filter((row) => workflowIds.has(row.workflowId)).slice(0, 200),
  };
}

/**
 * @param {string} skillId
 * @param {Record<string, any>} params
 */
async function runSkill(skillId, params) {
  if (!SKILLS.some((skill) => skill.id === skillId)) {
    return { state: 'failed', message: `Unknown skill: ${skillId}. Available: ${skillIds().join(', ')}.` };
  }
  const execute = params.mode === 'execute';

  if (skillId === 'create-pr') {
    if (!execute) {
      const missing = missingParams(['owner', 'repo', 'head', 'base'], params);
      if (missing) return missing;
      return {
        state: 'completed',
        artifact: planArtifact('create-pr-plan', params, [
          'Validate branch protection on the target repository',
          'Generate the PR title and body from the generation rules',
          'Enqueue the create-pr automation action for the matching workflow stage',
          'The engine drainer opens the pull request and records the run',
        ]),
      };
    }
    const context = missingExecutionContext(params);
    if (context) return context;
    const payload = await engineEnqueue('create-pr', params);
    return {
      state: 'completed',
      artifact: executionArtifact('create-pr-execution', params, payload, `create-pr enqueued as action ${payload.action?.id ?? '?'}.`),
    };
  }

  if (skillId === 'merge-pr') {
    if (!execute) {
      const missing = missingParams(['owner', 'repo', 'number'], params);
      if (missing) return missing;
      return {
        state: 'completed',
        artifact: planArtifact('merge-pr-plan', params, [
          'Verify all predecessor gates merged',
          'Check post-merge checks and deployment gates',
          'Confirm mergeability from GitHub',
          'Enqueue the merge-pr automation action for the matching workflow stage',
        ]),
      };
    }
    if (params.confirm !== true) {
      return {
        state: 'input-required',
        message: '"merge-pr" is irreversible. Resend with confirm=true (and the workflow stage context) to enqueue it, or approve it in the local UI.',
        escalation: { level: 'operator', reason: 'irreversible: merge on the target repository', options: ['approve', 'reject'] },
      };
    }
    const context = missingExecutionContext(params);
    if (context) return context;
    const payload = await engineEnqueue('merge-pr', params);
    return {
      state: 'completed',
      artifact: executionArtifact('merge-pr-execution', params, payload, `merge-pr enqueued as action ${payload.action?.id ?? '?'}.`),
    };
  }

  if (skillId === 'rerun-actions') {
    if (!execute) {
      const missing = missingParams(['owner', 'repo', 'runId'], params);
      if (missing) return missing;
      return {
        state: 'completed',
        artifact: planArtifact('rerun-actions-plan', params, [
          'Locate the failed workflow run',
          'Call the local engine rerun for the matching workflow stage',
          'Track the new run through reconciliation',
        ]),
      };
    }
    const context = missingExecutionContext(params);
    if (context) return context;
    const payload = await engineRerun(params);
    return {
      state: 'completed',
      artifact: executionArtifact('rerun-actions-execution', params, payload, 'Failed Actions rerun requested.'),
    };
  }

  if (skillId === 'deployment-health') {
    if (!params.repository && !params.workflowId) {
      return { state: 'input-required', message: 'Missing required parameters: repository or workflowId.' };
    }
    if (!execute) {
      return {
        state: 'completed',
        artifact: planArtifact('deployment-health-plan', params, [
          'Read the local workflow and deployment projection',
          'Report stage health with recent deployment runs',
          'Point at the failure center for anything unhealthy',
        ]),
      };
    }
    const payload = await readDeploymentHealth(params);
    return {
      state: 'completed',
      artifact: executionArtifact(
        'deployment-health-execution',
        params,
        payload,
        `Deployment health: ${payload.workflows.length} workflow(s), ${payload.deployments.length} deployment row(s).`,
      ),
    };
  }

  // production-rollback
  if (!execute) {
    const missing = missingParams(['owner', 'repo', 'environment'], params);
    if (missing) return missing;
    return {
      state: 'completed',
      artifact: planArtifact('production-rollback-plan', params, [
        'Identify the last healthy deployment',
        'Open the failure center and confirm the rollback target',
        'Dispatch the rollback from the local UI after operator approval',
        'Verify the environment recovered',
      ]),
    };
  }
  return {
    state: 'input-required',
    message: '"production-rollback" is irreversible and always requires operator approval. Use the deployment card in the local UI after confirming the run id.',
    escalation: { level: 'operator', reason: 'irreversible: production rollback', options: ['approve', 'reject'] },
  };
}

/* -------------------------------------------------------------------------- */
/* JSON-RPC                                                                    */
/* -------------------------------------------------------------------------- */

function isValidJsonRpcRequest(value) {
  if (typeof value !== 'object' || value === null) return false;
  const request = value;
  return request.jsonrpc === '2.0'
    && typeof request.method === 'string'
    && (request.id === undefined || typeof request.id === 'number' || typeof request.id === 'string' || request.id === null);
}

function parseMessage(params) {
  const message = params?.message;
  if (typeof message !== 'object' || message === null) {
    return { error: { ...JSONRPC_ERRORS.INVALID_PARAMS, message: 'params.message is required' } };
  }
  if (message.role !== 'user' || !Array.isArray(message.parts)) {
    return { error: { ...JSONRPC_ERRORS.INVALID_PARAMS, message: 'params.message must be a user message with parts' } };
  }
  return { message };
}

function parseSkillAndParams(message) {
  for (const part of message.parts) {
    if (part.kind === 'data' && typeof part.data?.skill === 'string') {
      const { skill, ...params } = part.data;
      return { skill, params };
    }
  }
  for (const part of message.parts) {
    if (part.kind === 'text') {
      const skill = String(part.text ?? '').trim().split(/\s+/)[0];
      if (skill) return { skill, params: {} };
    }
  }
  return { error: { ...JSONRPC_ERRORS.INVALID_PARAMS, message: 'no skill found in message; include a data part with a skill field' } };
}

function extractRunId(history) {
  for (const message of history) {
    const runId = message.metadata?.['x-zeus-runId'];
    if (typeof runId === 'string' && runId) return runId;
  }
  return undefined;
}

async function executeTask(storeApi, message, onTransition) {
  const parsed = parseSkillAndParams(message);
  if (parsed.error) throw parsed.error;
  const { skill, params } = parsed;
  const runId = extractRunId([message]);
  let task = storeApi.create([message], runId ? { 'x-zeus-runId': runId } : undefined);
  const startedAt = Date.now();

  const emit = (event) => onTransition?.(event);
  const statusEvent = (state, final) => ({
    kind: 'status-update',
    taskId: task.id,
    contextId: task.contextId,
    status: { state, timestamp: new Date().toISOString() },
    final,
    ...(runId ? { 'x-zeus': { runId } } : {}),
  });

  emit(statusEvent('submitted', false));
  task = storeApi.update(task.id, (current) => setState(current, 'working', new Date().toISOString()));
  emit(statusEvent('working', false));

  let result;
  try {
    result = await runAsActor(A2A_ACTOR, async () => {
      const outcome = await runSkill(skill, params);
      await appendAudit({
        ok: outcome.state === 'completed',
        action: 'a2a.execute',
        skill,
        mode: params.mode === 'execute' ? 'execute' : 'plan',
        ...(params.workflowId ? { workflowId: params.workflowId } : {}),
      });
      return outcome;
    });
  } catch (error) {
    result = { state: 'failed', message: error instanceof Error ? error.message : 'skill execution failed' };
  }
  const wallSeconds = Math.max(0, Math.round((Date.now() - startedAt) / 100) / 10);

  if (result.state === 'completed') {
    const artifact = { ...result.artifact, artifactId: randomUUID() };
    const report = artifact['x-zeus-report'];
    artifact['x-zeus-report'] = report
      ? { ...report, cost: { ...report.cost, wallSeconds } }
      : { summary: `${skill}: completed.`, evidence: [], cost: { llmTokens: 0, wallSeconds }, followUps: [] };
    task = storeApi.update(task.id, (current) => ({ ...current, artifacts: [...current.artifacts, artifact] }));
    emit({ kind: 'artifact-update', taskId: task.id, contextId: task.contextId, artifact, ...(runId ? { 'x-zeus': { runId } } : {}) });
    task = storeApi.update(task.id, (current) => setState(current, 'completed', new Date().toISOString()));
    emit(statusEvent('completed', true));
  } else if (result.state === 'input-required') {
    task = storeApi.update(task.id, (current) => ({
      ...current,
      history: [...current.history, { role: 'agent', parts: [{ kind: 'text', text: result.message }] }],
    }));
    task = storeApi.update(task.id, (current) => setState(current, 'input-required', new Date().toISOString()));
    emit({
      ...statusEvent('input-required', true),
      ...(result.escalation ? { 'x-zeus-escalation': result.escalation } : {}),
    });
  } else {
    task = storeApi.update(task.id, (current) => ({
      ...current,
      history: [...current.history, { role: 'agent', parts: [{ kind: 'text', text: result.message }] }],
    }));
    task = storeApi.update(task.id, (current) => setState(current, 'failed', new Date().toISOString()));
    emit(statusEvent('failed', true));
  }

  return task;
}

async function handleJsonRpc(storeApi, request, onEvent) {
  const respond = (result) => ({ jsonrpc: '2.0', id: request.id, result });
  const reject = (error) => ({ jsonrpc: '2.0', id: request.id, error });

  const methods = ['tasks/send', 'tasks/sendSubscribe', 'tasks/get', 'tasks/cancel'];
  if (!methods.includes(request.method)) return reject(JSONRPC_ERRORS.METHOD_NOT_FOUND);

  try {
    if (request.method === 'tasks/send' || request.method === 'tasks/sendSubscribe') {
      if (!onEvent && request.method === 'tasks/sendSubscribe') {
        return reject({ ...JSONRPC_ERRORS.INTERNAL, message: 'sendSubscribe requires an event sink' });
      }
      const parsed = parseMessage(request.params);
      if (parsed.error) return reject(parsed.error);
      const task = await executeTask(storeApi, parsed.message, onEvent);
      return respond(task);
    }
    if (request.method === 'tasks/get') {
      const id = request.params?.id;
      if (typeof id !== 'string' || !id) return reject({ ...JSONRPC_ERRORS.INVALID_PARAMS, message: 'params.id is required' });
      const task = storeApi.get(id);
      if (!task) return reject(JSONRPC_ERRORS.TASK_NOT_FOUND);
      const historyLength = typeof request.params?.historyLength === 'number' ? request.params.historyLength : undefined;
      return respond(historyLength === undefined ? task : { ...task, history: task.history.slice(-historyLength) });
    }
    const id = request.params?.id;
    if (typeof id !== 'string' || !id) return reject({ ...JSONRPC_ERRORS.INVALID_PARAMS, message: 'params.id is required' });
    const existing = storeApi.get(id);
    if (!existing) return reject(JSONRPC_ERRORS.TASK_NOT_FOUND);
    if (!['submitted', 'working', 'input-required'].includes(existing.status.state)) {
      return reject(JSONRPC_ERRORS.TASK_NOT_CANCELABLE);
    }
    const canceled = storeApi.update(id, (current) => ({ ...current, status: { state: 'canceled', timestamp: new Date().toISOString() } }));
    return respond(canceled);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error) return reject(error);
    return reject(JSONRPC_ERRORS.INTERNAL);
  }
}

/* -------------------------------------------------------------------------- */
/* Routes                                                                      */
/* -------------------------------------------------------------------------- */

export function isA2aPublicPath(pathname) {
  return PUBLIC_PATHS.has(pathname);
}

/**
 * Public card + JSON-RPC handler. Called by main.mjs before the token guard;
 * the caller reads the raw body (256 KB cap) and passes it here.
 */
export async function handleA2aPublicRoute({ method, pathname, headers, rawBody, env = process.env }) {
  if (!PUBLIC_PATHS.has(pathname)) return null;
  const cors = { 'access-control-allow-origin': '*' };
  const url = cardUrl(headers);

  if (method === 'GET' || method === 'HEAD') {
    return {
      status: 200,
      json: buildAgentCard({ url }),
      headers: { ...cors, 'cache-control': 'public, max-age=300' },
    };
  }
  if (method === 'OPTIONS') {
    return {
      status: 204,
      raw: '',
      headers: {
        ...cors,
        allow: 'GET, HEAD, POST, OPTIONS',
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS',
      },
    };
  }
  if (pathname !== CARD_PATH) {
    return { status: 405, json: { error: 'method not allowed' }, headers: cors };
  }
  if (method !== 'POST') {
    return { status: 405, json: { error: 'method not allowed' }, headers: cors };
  }

  const config = await resolveA2aAuth(env);
  const decision = evaluateA2aAccess({
    presentedToken: bearerToken(headers),
    expectedToken: config.token,
    expectedTokenHash: config.tokenHash,
    allowAnonymous: config.allowAnonymous,
  });
  if (decision === 'unconfigured') {
    return { status: 503, json: { message: 'A2A 未配置 PR_HELPER_GIT_A2A_TOKEN，服务不可用' }, headers: cors };
  }
  if (decision === 'unauthorized') {
    return {
      status: 401,
      json: { message: 'Unauthorized' },
      headers: { ...cors, 'www-authenticate': 'Bearer' },
    };
  }

  let payload;
  try {
    payload = JSON.parse(rawBody || '{}');
  } catch {
    return { status: 400, json: { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, headers: cors };
  }
  if (!isValidJsonRpcRequest(payload)) {
    return { status: 400, json: { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }, headers: cors };
  }

  if (payload.method === 'tasks/sendSubscribe') {
    const events = [];
    const result = await handleJsonRpc(taskStore, payload, (event) => events.push(event));
    const frames = events.map((event) => `data: ${JSON.stringify({ jsonrpc: '2.0', id: payload.id, result: event })}\n\n`);
    return {
      status: 200,
      contentType: 'text/event-stream',
      raw: `${frames.join('')}data: ${JSON.stringify(result)}\n\n`,
      headers: cors,
    };
  }

  return { status: 200, json: await handleJsonRpc(taskStore, payload), headers: cors };
}

/** Authenticated status + token management routes for the settings UI. */
export async function handleA2aAdminRoute({ method, pathname, headers, identity }) {
  if (pathname !== STATUS_PATH && pathname !== TOKEN_PATH) return null;
  const auth = await resolveA2aAuth();

  if (pathname === TOKEN_PATH) {
    if (identity?.role !== 'admin') return fail(403, 'admin access required');
    if (method === 'POST') {
      const generated = await generateA2aToken();
      await appendAudit({ ok: true, action: 'a2a.token.generate', hint: generated.hint });
      return ok({ ...generated, source: 'config' });
    }
    if (method === 'DELETE') {
      await revokeA2aToken();
      await appendAudit({ ok: true, action: 'a2a.token.revoke' });
      const next = await resolveA2aAuth();
      return ok({ ok: true, configured: next.source !== null, source: next.source });
    }
    return fail(405, 'method not allowed');
  }

  if (method !== 'GET') return fail(405, 'method not allowed');
  return ok({
    configured: auth.source !== null,
    source: auth.source,
    hint: auth.hint,
    createdAt: auth.createdAt,
    allowAnonymous: auth.allowAnonymous,
    cardUrl: cardUrl(headers),
    skills: skillIds(),
    tokenEnv: 'PR_HELPER_GIT_A2A_TOKEN',
    legacyTokenEnv: 'ZEUS_A2A_TOKEN',
  });
}
