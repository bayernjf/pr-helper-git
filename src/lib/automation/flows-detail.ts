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
import { stageRunPresentation, workflowProgress, type StageRunTone } from './workflow-run';
import { projectedStageStatus } from './projected-stage';
import { t, tp } from '../../i18n';
import type { BoardState, WorkflowStageStateRow } from './flows-board';

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

function stageStateText(kind: 'not-created' | 'open' | 'merged' | 'closed', checksState: string | undefined, hasChecks: boolean): string {
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
    const projectedRow: import('./projected-stage').ProjectedStageState | undefined = primary
      ? {
          repository: flow.repository,
          pullState: primary.pullState ?? '',
          checksState: primary.checksState ?? '',
          pullNumber: primary.pullNumber ?? null,
          headSha: null,
          mergedAt: null,
          checksPassed: primary.checksPassed ?? 0,
          checksTotal: primary.checksTotal ?? 0,
          approvals: 0,
          requiredApprovals: 0,
          mergeable: null,
          mergeableState: null,
        }
      : undefined;
    const status = projectedStageStatus(projectedRow);
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

/** Progress bar model over the per-stage tones (workflow-run.ts semantics). */
export function flowProgress(state: BoardState, flow: Workflow) {
  const tones = flow.stages.map((_stage, index) => {
    const routes = matchingStageProjections(flow, index, state.states);
    const primary = routes[0];
    const run = stageRunPresentation(
      primary && (primary.pullState !== undefined || primary.checksState !== undefined || primary.pullNumber != null)
        ? { pullState: primary.pullState ?? '', checksState: primary.checksState ?? '', pullNumber: primary.pullNumber ?? null }
        : undefined,
    );
    return run.tone;
  });
  return workflowProgress(tones.map((tone) => (tone === 'succeeded' ? 'succeeded' : tone === 'failed' ? 'failed' : tone === 'running' ? 'running' : 'idle')));
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
