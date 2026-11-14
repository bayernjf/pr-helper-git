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
  recoveryStatuses: Array<Record<string, unknown>>;
  automation: AutomationActionRow[];
  readWarnings?: Array<{ source: string; message: string }>;
};

export function fetchInbox(): Promise<InboxPayload> {
  return request<InboxPayload>('/api/flows/inbox');
}

export function fetchFlows(): Promise<{ workflows: Workflow[] }> {
  return request<{ workflows: Workflow[] }>('/api/flows/workflows');
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
