// Control-tower API client (Phase 3). Server surface: server/flows.mjs.
import { request } from './core';
import { peekSnapshot, putSnapshot } from './snapshot';
import type { Workflow } from '../lib/automation/workflow';
import type {
  ActionQueueItem,
  AutomationActionRow,
  WorkflowStageStateRow,
} from '../lib/automation/flows-board';
import type { StageEventRow } from '../lib/automation/flows-detail';

export type DeploymentRow = {
  workflowId: string;
  stageIndex: number;
  stageId?: string | null;
  source: string;
  provider: 'vercel' | 'cloudflare';
  environment: 'preview' | 'production';
  runId: number | null;
  runName: string;
  runUrl: string | null;
  deploymentUrl: string | null;
  state: 'pending' | 'success' | 'failure';
  conclusion: string | null;
  failureSummary: string | null;
  failureJobUrl: string | null;
  healthState: 'success' | 'failure' | null;
  healthUrl: string | null;
  healthDetail: string | null;
  updatedAt?: string | null;
};

export type DeploymentRunRow = Omit<DeploymentRow, 'failureSummary' | 'failureJobUrl'> & {
  failureSummary: null;
  failureJobUrl: null;
  firstSeenAt?: string | null;
};

export type DeploymentConfigurationWarningRow = {
  workflowId: string;
  target?: string;
  provider?: 'vercel' | 'cloudflare';
  code: string;
  value?: string;
};

export type DeploymentOptions = {
  actionsAvailable: boolean;
  workflows: Array<{ name: string; path: string }>;
  environmentsAvailable: boolean;
  environments: string[];
};

export type FlowPreflightCategory = 'app' | 'branch' | 'pr' | 'dependency' | 'actions' | 'environment';
export type FlowPreflightStatus = 'pass' | 'warn' | 'fail' | 'skip';

export type FlowPreflightFinding = {
  category: FlowPreflightCategory;
  code: string;
  status: FlowPreflightStatus;
  title: string;
  detail: string;
  suggestion: string;
  stageIndex?: number;
  pullNumber?: number;
};

export type FlowPreflightResult = {
  workflowId: string;
  repository: string;
  checkedAt: string;
  ok: boolean;
  findings: FlowPreflightFinding[];
};

/** POST /api/flows/preflight — read-only P3-13 flow check. */
export function fetchFlowPreflight(workflowId: string): Promise<{ preflight: FlowPreflightResult }> {
  return request<{ preflight: FlowPreflightResult }>('/api/flows/preflight', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workflowId }),
  });
}

export type BoardPreflightPayload = {
  results: FlowPreflightResult[];
  errors: Array<{ workflowId: string; message: string }>;
};

/** POST /api/flows/preflight {all:true} — board-level aggregate, still read-only. */
export function fetchBoardPreflight(): Promise<BoardPreflightPayload> {
  return request<BoardPreflightPayload>('/api/flows/preflight', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ all: true }),
  });
}

export type WorkflowRunRow = {
  id: string;
  workflowId: string;
  version: number | null;
  stageIndex: number;
  stageId: string | null;
  source: string;
  target: string;
  pullNumber: number | null;
  state: string;
  startedAt: string | null;
  completedAt: string | null;
};

export type SyncHealth = {
  lastReconciliation: {
    id: string;
    trigger: string;
    state: string;
    stagesTotal: number;
    stagesReconciled: number;
    stagesFailed: number;
    durationMs: number | null;
    errorMessage: string | null;
    repository: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    interrupted: boolean;
  } | null;
  triggerHealth: Array<Record<string, unknown>>;
  stages: Array<{
    workflowId: string;
    stageIndex: number;
    stageId: string | null;
    source: string;
    target: string;
    updatedAt: string;
    ageSeconds: number;
    stale: boolean;
  }>;
  webhookDeliveriesLast24h: number;
};

export type InboxPayload = {
  items: ActionQueueItem[];
  states: WorkflowStageStateRow[];
  events: StageEventRow[];
  deployments: DeploymentRow[];
  deploymentRuns: DeploymentRunRow[];
  configurationWarnings: DeploymentConfigurationWarningRow[];
  syncHealth: SyncHealth | null;
  runs: WorkflowRunRow[];
  timeline: import('../lib/automation/flows-board').TimelineRow[];
  recoveryStatuses: Array<import('../lib/automation/flows-board').RecoveryStatusRow>;
  automation: AutomationActionRow[];
  readWarnings?: Array<{ source: string; message: string }>;
  reconciliationScheduled?: boolean;
  reconciliation?: { outcome?: string; reconciled?: number } | null;
};

export type InboxRequest = {
  /** Trigger an inline realtime reconcile (manual queue refresh). */
  refresh?: boolean;
  /** Restrict the reconcile to one managed repository. */
  repository?: string;
};

/**
 * Last successful projection, kept at module scope so switching pages does not
 * blank the board while the next fetch is in flight. The page renders this
 * immediately and replaces it when the fresh payload arrives.
 */
const INBOX_SNAPSHOT_KEY = 'flows:inbox';
const FLOWS_SNAPSHOT_KEY = 'flows:workflows';

export function peekInboxSnapshot(): InboxPayload | null {
  return peekSnapshot<InboxPayload>(INBOX_SNAPSHOT_KEY);
}

export function peekFlowsSnapshot(): Workflow[] | null {
  return peekSnapshot<Workflow[]>(FLOWS_SNAPSHOT_KEY);
}

export async function fetchInbox(options: InboxRequest = {}): Promise<InboxPayload> {
  const params = new URLSearchParams();
  if (options.refresh) params.set('refresh', '1');
  if (options.repository) params.set('repository', options.repository);
  const query = params.toString();
  const payload = await request<InboxPayload>(`/api/flows/inbox${query ? `?${query}` : ''}`);
  putSnapshot(INBOX_SNAPSHOT_KEY, payload);
  return payload;
}

export async function fetchFlows(): Promise<{ workflows: Workflow[] }> {
  const payload = await request<{ workflows: Workflow[] }>('/api/flows/workflows');
  putSnapshot(FLOWS_SNAPSHOT_KEY, payload.workflows);
  return payload;
}

// Teams (P2-8): the engine's four-role model. Owner-only writes; members and
// shared workflows are scoped per team.
export type TeamSummary = {
  id: string;
  name: string;
  role: import('../lib/automation/team-permissions').TeamRole;
  createdAt?: string;
};
export type TeamMemberRow = {
  githubLogin: string;
  role: import('../lib/automation/team-permissions').TeamRole;
};

export function fetchTeams(): Promise<{ teams: TeamSummary[] }> {
  return request<{ teams: TeamSummary[] }>('/api/flows/teams');
}

export function fetchTeamMembers(teamId: string): Promise<{ members: TeamMemberRow[] }> {
  return request<{ members: TeamMemberRow[] }>(`/api/flows/teams?teamId=${encodeURIComponent(teamId)}`);
}

export function createTeam(name: string): Promise<{ team: TeamSummary }> {
  return request<{ team: TeamSummary }>('/api/flows/teams', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'create', name }),
  });
}

export function addTeamMember(input: { teamId: string; githubLogin: string; role: string }): Promise<{ ok: true }> {
  return request<{ ok: true }>('/api/flows/teams', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'member', ...input }),
  });
}

export function removeTeamMember(input: { teamId: string; githubLogin: string }): Promise<{ ok: true }> {
  return request<{ ok: true }>('/api/flows/teams', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'remove-member', ...input }),
  });
}

export function shareWorkflowWithTeam(input: { teamId: string; workflowId: string }): Promise<{ ok: true }> {
  return request<{ ok: true }>('/api/flows/teams', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'share-workflow', ...input }),
  });
}

// AI automation credentials (M-E5 tail): drive auto-create PR message
// generation. Stored server-side, encrypted with the local key.
export type AiAutomationCredential = {
  configured: boolean;
  baseUrl?: string;
  model?: string;
  keyMask?: string | null;
  autoGeneratePrMessage?: boolean;
  autoConfirmPrCreation?: boolean;
} | null;

export function fetchAiCredential(): Promise<{ credential: AiAutomationCredential }> {
  return request<{ credential: AiAutomationCredential }>('/api/flows/ai-credentials');
}

export function saveAiCredential(input: {
  baseUrl: string;
  model: string;
  apiKey: string;
  autoGeneratePrMessage: boolean;
  autoConfirmPrCreation: boolean;
}) {
  return request<{ credential: AiAutomationCredential }>('/api/flows/ai-credentials', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function deleteAiCredential() {
  return request<{ ok: boolean }>('/api/flows/ai-credentials', { method: 'DELETE' });
}

export function testSavedAiCredential() {
  return request<{ message?: string; model?: string }>('/api/flows/ai-credentials?action=test-saved', {
    method: 'POST',
  });
}

export type GenerationRuleRow = {
  name: string;
  contentHash: string;
  content: string;
  createdAt: string | null;
  label: string;
};

export function repairContext(input: { workflowId: string; stageIndex: number; source?: string; pullNumber?: number }) {
  return request<Record<string, unknown>>('/api/flows/repair-context', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function fetchGenerationRules(): Promise<{ rules: GenerationRuleRow[] }> {
  return request<{ rules: GenerationRuleRow[] }>('/api/flows/rules');
}

export function saveRule(input: { name: string; content: string }) {
  return request<{ ok: boolean; contentHash: string; name: string }>('/api/flows/rules', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function deleteRule(contentHash: string) {
  return request<{ ok: boolean }>('/api/flows/rules', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contentHash }),
  });
}

/** DELETE /api/flows/workflows — confirmed local delete (P3-12 tail). */
export function deleteFlowFromServer(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/api/flows/workflows', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
  });
}

/** PUT /api/flows/workflows — saves a full workflow payload (P3-4). */
export function saveWorkflowToServer(workflow: Workflow): Promise<Workflow> {
  return request<{ ok: boolean; workflow: Workflow; automationActivated: { create: boolean; merge: boolean }; gatesChanged: boolean }>(
    '/api/flows/workflows',
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workflow }),
    },
  ).then((payload) => payload.workflow);
}

export type FlowAuditEntry = {
  id: number | string;
  action: string;
  outcome: string;
  repository: string | null;
  workflowId: string | null;
  stageId: string | null;
  source: string | null;
  target: string | null;
  pullNumber: number | null;
  runId: number | null;
  metadata: Record<string, unknown>;
  failureReason: string | null;
  occurredAt: string;
};

export function fetchFlowAudit(limit = 100) {
  return request<{ entries: FlowAuditEntry[] }>(`/api/flows/audit?limit=${limit}`);
}

// --- Write routes (P3-3) ---------------------------------------------------

export type EnqueueInput = {
  workflowId: string;
  stageIndex: number;
  source: string;
  kind: 'create-pr' | 'merge-pr' | 'advance-stage';
  idempotencyKey: string;
};

/** Plain POST enqueues a new automation action (board/drawer buttons). */
export function enqueueAutomation(input: EnqueueInput) {
  return request<{ action: Record<string, unknown> }>('/api/flows/automation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

function automationAction(action: 'execute' | 'regenerate' | 'takeover', body: Record<string, unknown>) {
  return request<{ result: Record<string, unknown> }>(`/api/flows/automation?action=${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function executeAutomationAction(actionId: number) {
  return automationAction('execute', { actionId });
}

export function regenerateAutomationMessage(actionId: number) {
  return automationAction('regenerate', { actionId });
}

export function takeoverAutomationAction(actionId: number, title: string, body: string) {
  return automationAction('takeover', { actionId, title, body });
}

export function recordRecoveryEvent(input: { workflowId: string; stageIndex: number; source: string }) {
  return request<{ ok: boolean }>('/api/flows/recovery-event', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function rerunFailedActions(input: { workflowId: string; stageIndex: number; source: string }) {
  return request<{ result: Record<string, unknown> }>('/api/flows/rerun-actions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

// --- Deployment gates (P3-10) ---------------------------------------------

export function fetchDeploymentOptions(repository: string) {
  return request<DeploymentOptions>(`/api/flows/deployment-options?repository=${encodeURIComponent(repository)}`);
}

export function rollbackDeployment(input: {
  workflowId: string;
  stageIndex: number;
  source: string;
  provider: 'vercel' | 'cloudflare';
  runId: number;
}) {
  return request<{ ok: boolean; result: { workflowName: string } }>('/api/flows/deployment-rollback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function retryDeploymentRun(input: {
  workflowId: string;
  stageIndex: number;
  source: string;
  provider: 'vercel' | 'cloudflare';
  runId: number;
}) {
  return request<{ ok: boolean; result: { runId: number; provider: string; runName: string } }>('/api/flows/deployment-retry', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}
