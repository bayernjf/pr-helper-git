// Failure center semantics, ported from pr-helper (Phase 3, P3-5).
//
// Source of truth: src/main.ts failureCenterPanel — three aggregated
// sections (check failures & approvals, deployment failures, blocked
// automation) behind a total counter, with per-item recovery badges.
// Dependency-injected like flows-board/flows-detail.

import { automationActionPresentation, type AutomationActionState } from './workflow-run';
import { t, tp } from '../../i18n';
import type { ActionQueueItem, AutomationActionRow, BoardState, WorkflowStageStateRow } from './flows-board';

export type RecoveryStatusRow = {
  workflowId: string;
  stageIndex: number;
  source: string;
  retryCount?: number;
  maxRetries?: number;
  exhausted?: boolean;
  cooldownRemainingSeconds?: number;
  escalationNeeded?: boolean;
};

export type FailureItem = {
  key: string;
  tone: 'failed' | 'attention';
  icon: '✗' | '⏳' | '🔴' | '⏸';
  workflowId: string;
  workflowName: string;
  route: string;
  pullNumber: number | null;
  message: string;
  /** Present on check-failure rows: rerun availability per recovery policy. */
  recovery?: {
    retryDisabled: boolean;
    badge: string | null;
  };
  /** Present on blocked-automation rows: the takeover entry (create-pr + paused). */
  takeoverActionId?: number | string;
  stageIndex: number;
  source: string;
};

export type FailureSections = {
  items: FailureItem[];
  deployItems: FailureItem[];
  automationItems: FailureItem[];
  total: number;
};

export function recoveryStatusFor(state: BoardState, workflowId: string, stageIndex: number, source: string): RecoveryStatusRow | undefined {
  return state.recoveryStatuses?.find(
    (row) => row.workflowId === workflowId && row.stageIndex === stageIndex && row.source === source,
  );
}

/** Recovery badge copy, mirroring derive.ts recoveryStatusBadge. */
export function recoveryBadge(status: RecoveryStatusRow | undefined): string | null {
  if (!status) return null;
  if (status.escalationNeeded) return t('recovery · escalation needed');
  if (status.exhausted) return tp('recovery · retries exhausted ({count})', { count: status.maxRetries ?? 0 });
  if ((status.cooldownRemainingSeconds ?? 0) > 0) {
    return tp('recovery · cooldown {seconds}s', { seconds: status.cooldownRemainingSeconds ?? 0 });
  }
  if ((status.retryCount ?? 0) > 0) {
    return tp('recovery · retried {count}/{max}', { count: status.retryCount ?? 0, max: status.maxRetries ?? 0 });
  }
  return null;
}

/**
 * Blocked automation actions: presentation.blocked and not resolved.
 * `resolvedKeys` mirrors the drawer's manual resolve marks (empty locally).
 */
export function blockedAutomation(state: BoardState): AutomationActionRow[] {
  return state.automationActions.filter((action) => {
    if (action.state !== 'paused' && action.state !== 'failed') return false;
    return automationActionPresentation({ state: action.state as AutomationActionState }).blocked;
  });
}

/** The three aggregated sections behind the total counter. */
export function failureSections(state: BoardState): FailureSections {
  const failures = state.actionQueue
    .filter((item) => item.kind === 'checks-failed' || item.kind === 'needs-approval')
    .map((item: ActionQueueItem) => {
      const recovery = item.kind === 'checks-failed'
        ? recoveryStatusFor(state, item.workflowId, item.stageIndex, item.source)
        : undefined;
      const flow = state.workflows.find((w) => w.id === item.workflowId);
      return {
        key: `${item.workflowId}:${item.stageIndex}:${item.source}:${item.kind}`,
        tone: item.kind === 'checks-failed' ? 'failed' : 'attention',
        icon: (item.kind === 'checks-failed' ? '✗' : '⏳') as '✗' | '⏳',
        workflowId: item.workflowId,
        workflowName: item.workflowName || flow?.name || item.workflowId,
        route: `${item.source} → ${item.target}`,
        pullNumber: item.pullNumber ?? null,
        message: item.message ?? '',
        recovery: item.kind === 'checks-failed'
          ? {
              retryDisabled: Boolean(recovery?.exhausted || (recovery?.cooldownRemainingSeconds ?? 0) > 0),
              badge: recoveryBadge(recovery),
            }
          : undefined,
        stageIndex: item.stageIndex,
        source: item.source,
      } as FailureItem;
    });

  const deployItems = state.states
    .filter((row: WorkflowStageStateRow) => row.checksState === 'failure' && row.pullState === 'merged')
    .flatMap((row) => {
      const flow = state.workflows.find((w) => w.id === row.workflowId);
      if (!flow) return [];
      return [{
        key: `deploy:${row.workflowId}:${row.stageIndex}:${row.source}`,
        tone: 'failed' as const,
        icon: '🔴' as const,
        workflowId: row.workflowId,
        workflowName: flow.name,
        route: `${row.source} → ${row.target}`,
        pullNumber: row.pullNumber ?? null,
        message: t('deployment failed after merge'),
        stageIndex: row.stageIndex,
        source: row.source,
      }];
    });

  const automationItems = blockedAutomation(state).flatMap((action) => {
    const flow = state.workflows.find((w) => w.id === action.workflowId);
    if (!flow) return [];
    const presentation = automationActionPresentation({ state: action.state as AutomationActionState });
    return [{
      key: `auto:${action.workflowId}:${action.stageIndex ?? -1}:${action.source}:${action.id ?? ''}`,
      tone: (presentation.tone === 'failed' ? 'failed' : 'attention') as 'failed' | 'attention',
      icon: (presentation.tone === 'failed' ? '✗' : '⏸') as '✗' | '⏸',
      workflowId: action.workflowId,
      workflowName: flow.name,
      route: `${action.source} → ${action.target ?? '—'}`,
      pullNumber: null,
      message: action.message?.trim() || t('automation reason unknown'),
      takeoverActionId: action.kind === 'create-pr' && action.state === 'paused' ? action.id : undefined,
      stageIndex: action.stageIndex ?? 0,
      source: action.source,
    }];
  });

  return {
    items: failures,
    deployItems,
    automationItems,
    total: failures.length + deployItems.length + automationItems.length,
  };
}
