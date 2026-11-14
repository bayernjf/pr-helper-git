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
