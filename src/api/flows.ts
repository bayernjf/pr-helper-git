// Control-tower API client (Phase 3). Server surface: server/flows.mjs.
import { request } from './core';
import type { Workflow } from '../lib/automation/workflow';
import type {
  ActionQueueItem,
  AutomationActionRow,
  WorkflowStageStateRow,
} from '../lib/automation/flows-board';
import type { StageEventRow } from '../lib/automation/flows-detail';

export type InboxPayload = {
  items: ActionQueueItem[];
  states: WorkflowStageStateRow[];
  events: StageEventRow[];
  deployments: Array<Record<string, unknown>>;
  deploymentRuns: Array<Record<string, unknown>>;
  configurationWarnings: Array<Record<string, unknown>>;
  syncHealth: Record<string, unknown> | null;
  runs: Array<Record<string, unknown>>;
  timeline: Array<Record<string, unknown>>;
  recoveryStatuses: Array<import('../lib/automation/flows-board').RecoveryStatusRow>;
  automation: AutomationActionRow[];
  readWarnings?: Array<{ source: string; message: string }>;
};

export function fetchInbox(): Promise<InboxPayload> {
  return request<InboxPayload>('/api/flows/inbox');
}

export function fetchFlows(): Promise<{ workflows: Workflow[] }> {
  return request<{ workflows: Workflow[] }>('/api/flows/workflows');
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
  contentHash: string;
  content: string;
  createdAt: string | null;
  label: string;
};

export function fetchGenerationRules(): Promise<{ rules: GenerationRuleRow[] }> {
  return request<{ rules: GenerationRuleRow[] }>('/api/flows/rules');
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

export function fetchFlowAudit(limit = 100) {
  return request<{ entries: Array<Record<string, unknown>> }>(`/api/flows/audit?limit=${limit}`);
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
