// Flow board semantics, ported from pr-helper (Phase 3, P3-1).
//
// Source of truth: pr-helper src/main.ts overview()/projectLane() and
// src/app/ui/derive.ts. This port is a dependency-injected rewrite: instead
// of reading the module-level singletons (workflowState/projection/uiState)
// the original mutated, every function takes the board state it needs, so it
// is unit-testable and React-renderable. The filter/count/step-tone rules
// below mirror the original line-for-line — see flows-board.test.ts.

import { githubPullUrl } from '../domain';
import {
  activeWorkflows,
  archivedWorkflows,
  isWorkflowMuted,
  matchingStageProjections,
  sortWorkflowsForView,
  type Workflow,
} from './workflow';
import {
  automationActionPresentation,
  stageRunPresentation,
  workflowRunSummary,
  type StageRunTone,
} from './workflow-run';
import { t, tp } from '../../i18n';

export type WorkflowStageStateRow = {
  workflowId: string;
  stageIndex: number;
  stageId?: string | null;
  source: string;
  target: string;
  pullNumber?: number | null;
  pullState?: string;
  checksState?: string;
  checksPassed?: number;
  checksTotal?: number;
  updatedAt?: string | null;
};

export type ActionQueueItem = {
  workflowId: string;
  workflowName?: string;
  repository?: string;
  stageIndex: number;
  source: string;
  target?: string;
  pullNumber?: number | null;
  kind: string;
  message?: string;
};

export type AutomationActionRow = {
  id?: number | string;
  workflowId: string;
  stageIndex?: number | null;
  stageId?: string | null;
  source: string;
  kind?: string;
  state: 'queued' | 'running' | 'paused' | 'failed';
  message?: string | null;
  updatedAt?: string;
};

export type BoardState = {
  workflows: readonly Workflow[];
  states: readonly WorkflowStageStateRow[];
  actionQueue: readonly ActionQueueItem[];
  automationActions: readonly AutomationActionRow[];
};

export type BoardFilter = 'attention' | 'running' | 'all' | 'failed' | 'automation' | 'archived';

export type BoardCounts = {
  attention: number;
  running: number;
  active: number;
  failed: number;
  automationBlocked: number;
  archived: number;
};

export type LaneStepModel = {
  stageIndex: number;
  source: string;
  target: string;
  tone: 'failed' | 'attention' | StageRunTone;
  label: string;
  pullNumber: number | null;
  hasQueueItem: boolean;
};

export type LaneModel = {
  workflow: Workflow;
  muted: boolean;
  summary: { stageIndex: number; tone: StageRunTone; pullNumber: number | null; text: string };
  steps: LaneStepModel[];
  attentionItems: ActionQueueItem[];
};

/**
 * Automation actions that stopped moving and nobody resolved yet
 * (derive.ts blockedAutomationActions: presentation.blocked minus resolved).
 * `resolvedKeys` carries the operator's manual marks (actionKey -> ttl),
 * empty until the drawer marks one resolved.
 */
export function blockedAutomationActions(
  automationActions: readonly AutomationActionRow[],
  resolvedKeys: ReadonlySet<string> = new Set(),
): AutomationActionRow[] {
  return automationActions.filter(
    (action) => automationActionPresentation(action).blocked && !resolvedKeys.has(actionKey(action)),
  );
}

/** Stable key for one automation action on one stage route. */
export function actionKey(action: Pick<AutomationActionRow, 'workflowId' | 'stageIndex' | 'source'>) {
  return `${action.workflowId}:${action.stageIndex ?? -1}:${action.source}`;
}

/** Six aggregate counters, identical to the original board summary. */
export function boardCounts(state: BoardState, resolvedKeys: ReadonlySet<string> = new Set()): BoardCounts {
  const failedCount = state.actionQueue.filter((item) => item.kind === 'checks-failed').length;
  const automationBlockedCount = blockedAutomationActions(state.automationActions, resolvedKeys).length;
  const workflowCount = activeWorkflows(state.workflows).length;
  const archivedCount = archivedWorkflows(state.workflows).length;
  // 'Running' includes every active workflow that is actively progressing:
  // either its current stage is in a running tone, or it sits in the attention
  // queue. 'Needs attention' is therefore a subset of 'Running'.
  const attentionWorkflowIds = new Set(state.actionQueue.map((item) => item.workflowId));
  const runningWorkflowIds = new Set<string>();
  for (const flow of activeWorkflows(state.workflows)) {
    if (attentionWorkflowIds.has(flow.id) || laneRunSummary(state, flow).tone === 'running') {
      runningWorkflowIds.add(flow.id);
    }
  }
  return {
    attention: state.actionQueue.length,
    running: runningWorkflowIds.size,
    active: workflowCount,
    failed: failedCount,
    automationBlocked: automationBlockedCount,
    archived: archivedCount,
  };
}

/**
 * Filter + sort + search, identical to overview() in pr-helper:
 * archived view shows only archived lanes, every other filter works on live
 * ones; 'attention' matches any action-queue presence, 'failed' only
 * checks-failed items.
 */
export function visibleWorkflows(
  state: BoardState,
  filter: BoardFilter,
  search: string,
  sortMode: Parameters<typeof sortWorkflowsForView>[1] = 'custom',
  sortDirection: Parameters<typeof sortWorkflowsForView>[2] = 'asc',
  resolvedKeys: ReadonlySet<string> = new Set(),
): Workflow[] {
  const boardWorkflows = filter === 'archived'
    ? archivedWorkflows(state.workflows)
    : activeWorkflows(state.workflows);
  const sorted = sortWorkflowsForView(boardWorkflows, sortMode, sortDirection);
  const blocked = blockedAutomationActions(state.automationActions, resolvedKeys);
  const matched = sorted.filter((flow) => {
    if (filter === 'all' || filter === 'archived') return true;
    if (filter === 'automation') return blocked.some((action) => action.workflowId === flow.id);
    if (filter === 'running') return runningIds(state).has(flow.id);
    return state.actionQueue.some(
      (item) => item.workflowId === flow.id && (filter === 'attention' || item.kind === 'checks-failed'),
    );
  });
  const normalized = search.trim().toLocaleLowerCase();
  if (!normalized) return matched;
  return matched.filter((flow) =>
    `${flow.name} ${flow.repository}`.toLocaleLowerCase().includes(normalized));
}

function runningIds(state: BoardState): Set<string> {
  const attentionWorkflowIds = new Set(state.actionQueue.map((item) => item.workflowId));
  const ids = new Set<string>();
  for (const flow of activeWorkflows(state.workflows)) {
    if (attentionWorkflowIds.has(flow.id) || laneRunSummary(state, flow).tone === 'running') {
      ids.add(flow.id);
    }
  }
  return ids;
}

/**
 * One stage route's presentation: a checks-failed queue item tones the step
 * failed, any other queue item makes it attention, otherwise the persisted
 * projection decides (derive.ts laneStep).
 */
export function laneStepModel(
  state: BoardState,
  flow: Workflow,
  stageIndex: number,
  projection?: WorkflowStageStateRow,
): LaneStepModel {
  const stage = flow.stages[stageIndex];
  const source = projection?.source || stage.source;
  const queueItem = state.actionQueue.find(
    (item) => item.workflowId === flow.id && item.stageIndex === stageIndex && item.source === source,
  );
  const run = stageRunPresentation(
    projection && (projection.pullState !== undefined || projection.checksState !== undefined || projection.pullNumber != null)
      ? { pullState: projection.pullState ?? '', checksState: projection.checksState ?? '', pullNumber: projection.pullNumber ?? null }
      : undefined,
  );
  const tone = queueItem?.kind === 'checks-failed' ? 'failed' : queueItem ? 'attention' : run.tone;
  const pullNumber = queueItem?.pullNumber ?? projection?.pullNumber ?? null;
  // The status text stays number-free — the interactive #N link carries the
  // reference; queue messages that already end in "#N" get it stripped.
  const rawLabel = queueItem?.message || stageRunText(run.status, null);
  const label = pullNumber != null && rawLabel.trimEnd().endsWith(`#${pullNumber}`)
    ? rawLabel.trimEnd().slice(0, -String(pullNumber).length - 1).trimEnd()
    : rawLabel;
  return {
    stageIndex,
    source,
    target: stage.target,
    tone,
    label,
    pullNumber,
    hasQueueItem: Boolean(queueItem),
  };
}

/** Run summary line for one lane (derive.ts laneRunSummary). */
export function laneRunSummary(state: BoardState, flow: Workflow): LaneModel['summary'] {
  const perStage = flow.stages.map((_stage, index) => {
    const row = stageStateFor(state, flow.id, index);
    if (row === undefined || (row.pullState === undefined && row.checksState === undefined && row.pullNumber == null)) {
      return undefined;
    }
    // Coerce the persisted row into the run-state shape the pure module reads.
    return { pullState: row.pullState ?? '', checksState: row.checksState ?? '', pullNumber: row.pullNumber ?? null };
  });
  const summary = workflowRunSummary(perStage);
  const status = summary.pullNumber
    ? tp('PR #{number} {status}', { number: summary.pullNumber, status: runStatusText(summary.status) })
    : runStatusText(summary.status);
  let text = tp('Step {step}/{total} · {status}', {
    step: summary.stageIndex + 1,
    total: flow.stages.length,
    status,
  });
  const routes = matchingStageProjections(flow, summary.stageIndex, state.states);
  const latestUpdatedAt = routes
    .map((route) => route.updatedAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  if (latestUpdatedAt) {
    text += ` · ${relativeUpdatedAt(latestUpdatedAt)}`;
  }
  return { stageIndex: summary.stageIndex, tone: summary.tone, pullNumber: summary.pullNumber, text };
}

/** StageId-preferred state lookup (derive.ts stageState). */
export function stageStateFor(
  state: BoardState,
  workflowId: string,
  stageIndex: number,
  source?: string,
  target?: string,
): WorkflowStageStateRow | undefined {
  const stageId = state.workflows
    .find((flow) => flow.id === workflowId)?.stages[stageIndex]?.stageId;
  return state.states.find((row) =>
    row.workflowId === workflowId
    && (stageId ? row.stageId === stageId : row.stageIndex === stageIndex)
    && (source === undefined || row.source === source)
    && (target === undefined || row.target === target));
}

/** All persisted projections for one stage (derive.ts statesForStage). */
export function statesForStage(state: BoardState, flow: Workflow, stageIndex: number) {
  return matchingStageProjections(flow, stageIndex, state.states);
}

/** Full lane models for rendering, in visible order. */
export function buildLaneModels(
  state: BoardState,
  filter: BoardFilter,
  search: string,
  sortMode: Parameters<typeof sortWorkflowsForView>[1] = 'custom',
  sortDirection: Parameters<typeof sortWorkflowsForView>[2] = 'asc',
  resolvedKeys: ReadonlySet<string> = new Set(),
): LaneModel[] {
  return visibleWorkflows(state, filter, search, sortMode, sortDirection, resolvedKeys).map((flow) => {
    const items = state.actionQueue.filter((item) => item.workflowId === flow.id);
    const steps = flow.stages.flatMap((_stage, index) => {
      const routes = statesForStage(state, flow, index);
      return routes.length
        ? routes.map((route) => laneStepModel(state, flow, index, route))
        : [laneStepModel(state, flow, index)];
    });
    return {
      workflow: flow,
      muted: isWorkflowMuted(flow),
      summary: laneRunSummary(state, flow),
      steps,
      attentionItems: items,
    };
  });
}

/** English run-status copy (i18n translates the sentence keys). */
const RUN_STATUS_TEXT: Record<string, string> = {
  'waiting-sync': 'waiting to sync',
  'waiting-for-changes': 'waiting for changes',
  'ready-to-create': 'ready to create a PR',
  'checks-running': 'checks running',
  'checks-passed': 'checks passed',
  'checks-failed': 'checks failed',
  'merged-pending': 'merged, awaiting advance',
};

function runStatusText(status: string): string {
  return t(RUN_STATUS_TEXT[status] ?? status);
}

function stageRunText(status: string, pullNumber: number | null): string {
  const statusText = runStatusText(status);
  return pullNumber ? tp('PR #{number} {status}', { number: pullNumber, status: statusText }) : statusText;
}

/** "M/D HH:mm" style updated stamp (derive.ts stageUpdatedAt). */
export function relativeUpdatedAt(updatedAt: string): string {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return '';
  return tp('updated {time}', {
    time: new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date),
  });
}

/** PR reference url helper re-exported for the lane cards. */
export function flowPullUrl(repository: string, pullNumber: number) {
  return githubPullUrl(repository, pullNumber);
}
