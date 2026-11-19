// Flow detail semantics, ported from pr-helper (Phase 3, P3-2).
//
// Source of truth: pr-helper src/app/render/detail.ts (detail()/stageTimeline())
// and src/lib/projected-stage.ts (already ported). Dependency-injected like
// flows-board.ts: every function takes the board state it reads, so the module
// stays unit-testable and React-renderable.
//
// Read-first slice: statuses render from the persisted projection (the same
// first-paint the original's live reads later revalidated — without GitHub App
// credentials locally there is no live revalidation yet, P2-1). Operations
// (create/merge/repair) belong to the step drawer, P3-3.

import { githubPullUrl } from '../domain';
import { matchingStageProjections, type Workflow } from './workflow';
import {
  automationActionPresentation,
  nextStepSummary,
  progressActionKey,
  stageProgressNode,
  stageRunPresentation,
  worstStageProgress,
  workflowProgress,
  type StageProgressStatus,
  type StageRunTone,
  type WorkflowProgress,
} from './workflow-run';
import { projectedStageStatus, type ProjectedStageState } from './projected-stage';
import { t, tp } from '../../i18n';
import { automationActionFor, statesForStage, type BoardState, type WorkflowStageStateRow } from './flows-board';

export type StageEventRow = {
  workflowId: string;
  stageIndex: number;
  source?: string | null;
  message?: string;
  occurredAt?: string;
};

export type StageDetailModel = {
  index: number;
  source: string;
  target: string;
  /** Dynamic (pattern) routes render the matched-branch list instead of one PR. */
  dynamic: boolean;
  tone: StageRunTone;
  stateText: string;
  gates: string[];
  pullNumber: number | null;
  pullUrl: string | null;
  headSha: string | null;
  aheadBy: number;
  /** Matched branch rows for dynamic stages. */
  routes: Array<{ source: string; pullNumber: number | null; tone: StageRunTone; label: string }>;
  events: Array<{ message: string; occurredAt: string }>;
  automation: {
    autoCreate: boolean;
    threshold: number;
    autoMerge: boolean;
    autoAdvance: boolean;
  };
};

export function stageStateText(kind: 'not-created' | 'open' | 'merged' | 'closed', checksState: string | undefined, hasChecks: boolean): string {
  // Mirrors stageTimeline's `state` decision (detail.ts): post-merge
  // verification, then action failures, approvals, mergeability, waiting.
  if (kind === 'merged') {
    if (checksState === 'success') return t('merged · post-merge checks passed');
    if (checksState === 'failure') return t('merged · post-merge checks failed');
    return hasChecks ? t('merged · post-merge checks running') : t('merged');
  }
  if (kind === 'closed') return t('closed');
  if (kind === 'not-created') return t('waiting to create a PR');
  if (checksState === 'failure') return t('checks failed');
  if (checksState === 'pending' || checksState === 'running') return t('checks running');
  return t('waiting for merge');
}

/** Per-stage detail models in stage order. */
export function buildStageDetails(state: BoardState, flow: Workflow, events: readonly StageEventRow[]): StageDetailModel[] {
  return flow.stages.map((stage, index) => {
    const routes = matchingStageProjections(flow, index, state.states);
    const primary = routes[0];
    const automation = (stage as { automation?: { autoCreatePullRequest?: boolean; autoMergePullRequest?: boolean; autoAdvanceNext?: boolean; triggerMinCommits?: number; executionMode?: string } }).automation;
    const dynamic = stage.source.includes('*');

    if (dynamic) {
      return {
        index,
        source: stage.source,
        target: stage.target,
        dynamic: true,
        tone: 'running',
        stateText: t('dynamic route — matches branches by pattern'),
        gates: [],
        pullNumber: null,
        pullUrl: null,
        headSha: null,
        aheadBy: 0,
        routes: routes.map((route) => {
          const run = stageRunPresentation(
            route.pullState !== undefined || route.checksState !== undefined || route.pullNumber != null
              ? { pullState: route.pullState ?? '', checksState: route.checksState ?? '', pullNumber: route.pullNumber ?? null }
              : undefined,
          );
          return {
            source: route.source,
            pullNumber: route.pullNumber ?? null,
            tone: run.tone,
            label: route.pullNumber
              ? tp('PR #{number} {status}', { number: route.pullNumber, status: runStatusText(run.status) })
              : runStatusText(run.status),
          };
        }),
        events: eventsFor(events, flow.id, index),
        automation: automationFlags(automation),
      };
    }

    // The projected first paint: everything the persisted row can answer.
    const status = projectedStageStatus(toProjectedRow(flow, primary));
    const run = stageRunPresentation(
      primary && (primary.pullState !== undefined || primary.checksState !== undefined || primary.pullNumber != null)
        ? { pullState: primary.pullState ?? '', checksState: primary.checksState ?? '', pullNumber: primary.pullNumber ?? null }
        : undefined,
    );

    const gates: string[] = [];
    if (primary?.checksTotal) {
      gates.push(tp('checks {passed}/{total} {state}', {
        passed: primary.checksPassed ?? 0,
        total: primary.checksTotal,
        state: primary.checksState === 'success'
          ? t('checks passed')
          : primary.checksState === 'failure' ? t('checks failed') : t('checks running'),
      }));
    }
    if (status?.kind === 'not-created' && status.aheadBy) {
      gates.push(tp('{count} new commits', { count: status.aheadBy }));
    }

    const kind = (status?.kind ?? 'not-created') as 'not-created' | 'open' | 'merged' | 'closed';
    const checksState = primary?.checksState;
    return {
      index,
      source: stage.source,
      target: stage.target,
      dynamic: false,
      tone: run.tone,
      stateText: stageStateText(kind, checksState, Boolean(primary?.checksTotal)),
      gates,
      pullNumber: primary?.pullNumber ?? null,
      pullUrl: primary?.pullNumber ? githubPullUrl(flow.repository, primary.pullNumber) : null,
      headSha: primary?.pullNumber ? (primary as WorkflowStageStateRow & { headSha?: string | null }).headSha ?? null : null,
      aheadBy: status?.aheadBy ?? 0,
      routes: [],
      events: eventsFor(events, flow.id, index),
      automation: automationFlags(automation),
    };
  });
}

/** Progress bar model over the server stage decisions (derive.ts flowProgressBar). */
export type FlowProgressModel = WorkflowProgress & {
  /** False while every node is idle — no projection has arrived yet. */
  synced: boolean;
  /** The first unfinished step plus the server decision's unlock condition. */
  next: { index: number; reason?: string } | null;
  /** Newest projection updatedAt across the flow's stages. */
  syncedAt: string | null;
};

const PROGRESS_ACTION_LABEL: Record<string, string> = {
  'create-pr': 'auto-create PR',
  'merge-pr': 'auto-merge PR',
  'advance-stage': 'auto-advance stage',
};

function toProjectedRow(flow: Workflow, primary: WorkflowStageStateRow | undefined): ProjectedStageState | undefined {
  if (!primary) return undefined;
  return {
    repository: flow.repository,
    pullState: primary.pullState ?? '',
    checksState: primary.checksState ?? '',
    pullNumber: primary.pullNumber ?? null,
    headSha: primary.headSha ?? null,
    mergedAt: primary.mergedAt ?? null,
    checksPassed: primary.checksPassed ?? 0,
    checksTotal: primary.checksTotal ?? 0,
    approvals: primary.approvals ?? 0,
    requiredApprovals: primary.requiredApprovals ?? 0,
    mergeable: primary.mergeable ?? null,
    mergeableState: primary.mergeableState ?? null,
    aheadBy: primary.aheadBy ?? 0,
  };
}

function toneProgressStatus(tone: StageRunTone): StageProgressStatus {
  return tone === 'succeeded' ? 'succeeded' : tone === 'failed' ? 'failed' : tone === 'running' ? 'running' : 'idle';
}

/** One stage's progress node: worst across its routes (derive.ts stageProgressStatus). */
export function stageProgressStatus(state: BoardState, flow: Workflow, stageIndex: number): StageProgressStatus {
  const routes = statesForStage(state, flow, stageIndex);
  const stageSource = flow.stages[stageIndex]?.source ?? '';
  if (!routes.length) {
    return stageProgressNode({ automation: automationActionFor(state, flow.id, stageIndex, stageSource) }).status;
  }
  return worstStageProgress(routes.map((route) => {
    const automation = automationActionFor(state, flow.id, stageIndex, route.source);
    if (route.decision) return stageProgressNode({ decision: route.decision, automation }).status;
    // Degraded reads carry no server decision; keep the projection-tone first
    // paint instead of re-deriving a gate in the browser.
    if (automation) return stageProgressNode({ automation }).status;
    const run = stageRunPresentation(
      route.pullState !== undefined || route.checksState !== undefined || route.pullNumber != null
        ? { pullState: route.pullState ?? '', checksState: route.checksState ?? '', pullNumber: route.pullNumber ?? null }
        : undefined,
    );
    return toneProgressStatus(run.tone);
  }));
}

/** Node tooltip: route, decision message, running automation, blocked reason. */
export function stageProgressTooltip(state: BoardState, flow: Workflow, stageIndex: number): string {
  const routes = statesForStage(state, flow, stageIndex);
  const stage = flow.stages[stageIndex];
  const action = automationActionFor(state, flow.id, stageIndex, routes[0]?.source || stage?.source || '');
  const lines = [`${stage?.source ?? ''} → ${stage?.target ?? ''}`];
  const message = routes.map((route) => route.decision?.message).find(Boolean);
  if (message) lines.push(message);
  // Name the running automation only when a server action exists and is moving.
  if (action && progressActionKey(action.kind) && !automationActionPresentation(action).blocked) {
    lines.push(`${t('Current action')}: ${t(PROGRESS_ACTION_LABEL[action.kind ?? ''] ?? action.kind ?? '')}`);
  }
  if (action && automationActionPresentation(action).blocked && action.failureReason?.trim()) {
    lines.push(action.failureReason.trim());
  }
  return lines.join(' · ');
}

export function flowProgress(state: BoardState, flow: Workflow): FlowProgressModel {
  const statuses = flow.stages.map((_stage, index) => stageProgressStatus(state, flow, index));
  const progress = workflowProgress(statuses);
  const synced = statuses.some((status) => status !== 'idle');
  const reasons = flow.stages.map((_stage, index) =>
    statesForStage(state, flow, index).map((route) => route.decision?.message).find(Boolean));
  const next = nextStepSummary(progress.nodes, reasons);
  const syncedAt = flow.stages
    .flatMap((_stage, index) => statesForStage(state, flow, index).map((route) => route.updatedAt))
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
  return { ...progress, synced, next, syncedAt };
}

export type NextActionKind = 'notStarted' | 'gateFailed' | 'canCheck' | 'synced';

/** The detail side panel's headline (detail.ts nextActionTitle). */
export function nextActionSummary(state: BoardState, flow: Workflow): NextActionKind {
  const routesPerStage = flow.stages.map((_stage, index) => statesForStage(state, flow, index));
  if (!routesPerStage.some((routes) => routes.length)) return 'notStarted';
  const dynamicFailure = flow.stages.some((stage, index) =>
    stage.source.includes('*') && routesPerStage[index].some((route) => route.checksState === 'failure'));
  if (dynamicFailure) return 'gateFailed';
  const statuses = routesPerStage.map((routes) => projectedStageStatus(toProjectedRow(flow, routes[0])));
  if (statuses.some((status, index) => status?.kind === 'open' && routesPerStage[index][0]?.checksState === 'failure')) return 'gateFailed';
  if (statuses.some((status) => status?.kind === 'not-created')) return 'canCheck';
  return 'synced';
}

function eventsFor(events: readonly StageEventRow[], workflowId: string, stageIndex: number) {
  return events
    .filter((event) => event.workflowId === workflowId && event.stageIndex === stageIndex)
    .slice(0, 20)
    .map((event) => ({ message: event.message || '', occurredAt: event.occurredAt || '' }));
}

function automationFlags(automation: { autoCreatePullRequest?: boolean; autoMergePullRequest?: boolean; autoAdvanceNext?: boolean; triggerMinCommits?: number } | undefined) {
  return {
    autoCreate: automation?.autoCreatePullRequest === true,
    threshold: automation?.triggerMinCommits || 1,
    autoMerge: automation?.autoMergePullRequest === true,
    autoAdvance: automation?.autoAdvanceNext === true,
  };
}

function runStatusText(status: string): string {
  const map: Record<string, string> = {
    'waiting-sync': 'waiting to sync',
    'waiting-for-changes': 'waiting for changes',
    'ready-to-create': 'ready to create a PR',
    'checks-running': 'checks running',
    'checks-passed': 'checks passed',
    'checks-failed': 'checks failed',
    'merged-pending': 'merged, awaiting advance',
  };
  return t(map[status] ?? status);
}
