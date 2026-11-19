// Resolve marks, ported from pr-helper ui/derive.ts
// (markAutomationResolved / isAutomationResolved / reconcileAutomationInBackground).
//
// A manual operation (create/merge/rerun/takeover) records that a person just
// moved this step, so the board drops it at once instead of holding the
// operator on a slow server reconciliation. Only the board's view is filtered
// — the drawer and the progress bar keep reading the server's real rows.
//
// A mark dies three ways: its TTL expires, a different or newer automation
// row surfaces on the route (a fresh event, not the one just handled), or the
// server projection agrees the step is no longer blocked.
//
// Note: the original called sourceRuleMatches(candidate, resolved) — swapped
// against its (rule, source) signature, so wildcard marks never matched there.
// This port follows the documented intent: a wildcard mark covers every
// concrete route beneath it.
import { sourceRuleMatches } from './workflow';
import { automationActionPresentation } from './workflow-run';
import type { AutomationActionRow, BoardState } from './flows-board';

export const RESOLVED_AUTOMATION_TTL_MS = 15 * 60_000;

export type ResolvedMark = {
  resolvedAt: number;
  source: string;
  actionId: string | number | null;
  updatedAt: string;
};

export type ResolvedMarks = ReadonlyMap<string, ResolvedMark>;

export function automationStepKey(workflowId: string, stageIndex: number, source: string) {
  return `${workflowId}|${stageIndex}|${source}`;
}

export function resolvedSourceMatches(resolved: string, candidate: string) {
  return resolved === candidate || (resolved.includes('*') && sourceRuleMatches(resolved, candidate));
}

function currentAction(actions: readonly AutomationActionRow[], workflowId: string, stageIndex: number, source: string): AutomationActionRow | undefined {
  return actions
    .filter((action) => action.workflowId === workflowId && action.stageIndex === stageIndex && action.source === source)
    .reduce<AutomationActionRow | undefined>((newest, action) => (!newest || (action.updatedAt ?? '') > (newest.updatedAt ?? '') ? action : newest), undefined);
}

function markStillValid(mark: ResolvedMark, actions: readonly AutomationActionRow[], workflowId: string, stageIndex: number, source: string, now: number): boolean {
  if (now - mark.resolvedAt > RESOLVED_AUTOMATION_TTL_MS) return false;
  const current = currentAction(actions, workflowId, stageIndex, source);
  // A different or newer row is a fresh event rather than the one just handled.
  if (current && ((current.id ?? null) !== mark.actionId || (current.updatedAt ?? '') > mark.updatedAt)) return false;
  return true;
}

export function isAutomationResolved(
  marks: ResolvedMarks,
  actions: readonly AutomationActionRow[],
  workflowId: string,
  stageIndex: number,
  source: string,
  now = Date.now(),
): boolean {
  const prefix = `${workflowId}|${stageIndex}|`;
  for (const [key, mark] of marks) {
    if (!key.startsWith(prefix) || !resolvedSourceMatches(mark.source, source)) continue;
    if (markStillValid(mark, actions, workflowId, stageIndex, source, now)) return true;
  }
  return false;
}

export function markResolved(
  marks: ResolvedMarks,
  actions: readonly AutomationActionRow[],
  workflowId: string,
  stageIndex: number,
  source: string,
  now = Date.now(),
): ResolvedMarks {
  const current = currentAction(actions, workflowId, stageIndex, source);
  const next = new Map(marks);
  next.set(automationStepKey(workflowId, stageIndex, source), {
    resolvedAt: now,
    source,
    actionId: current?.id ?? null,
    updatedAt: current?.updatedAt ?? '',
  });
  return next;
}

/**
 * Drop expired/superseded marks, and marks whose route the server no longer
 * reports as pending work — the projection caught up, so the local note has
 * served its purpose (the old background reconcile loop, folded into the read
 * path). Pending work means a blocked automation row or an attention-queue
 * item still covered by the mark. Returns the same map when nothing changed
 * so React state stays stable.
 */
export function pruneResolvedMarks(
  marks: ResolvedMarks,
  state: BoardState,
  now = Date.now(),
): ResolvedMarks {
  let changed = false;
  const next = new Map(marks);
  for (const [key, mark] of marks) {
    const [workflowId, stageIndexText] = key.split('|');
    const stageIndex = Number(stageIndexText);
    if (!markStillValid(mark, state.automationActions, workflowId, stageIndex, mark.source, now)) {
      next.delete(key);
      changed = true;
      continue;
    }
    const covered = (candidate: { workflowId: string; stageIndex?: number | null; source: string }) => candidate.workflowId === workflowId
      && (candidate.stageIndex ?? 0) === stageIndex
      && resolvedSourceMatches(mark.source, candidate.source);
    const stillPending = state.automationActions.some((action) => covered(action) && automationActionPresentation(action).blocked)
      || state.actionQueue.some(covered);
    if (!stillPending) {
      next.delete(key);
      changed = true;
    }
  }
  return changed ? next : marks;
}

/**
 * The board's filtered view: attention-queue items and blocked automation
 * rows covered by a valid mark disappear; everything else (stage projections,
 * workflows) passes through untouched.
 */
export function resolvedBoardState(state: BoardState, marks: ResolvedMarks, now = Date.now()): BoardState {
  if (!marks.size) return state;
  return {
    ...state,
    actionQueue: state.actionQueue.filter((item) => !isAutomationResolved(marks, state.automationActions, item.workflowId, item.stageIndex, item.source, now)),
    automationActions: state.automationActions.filter((action) => !isAutomationResolved(marks, state.automationActions, action.workflowId, action.stageIndex ?? 0, action.source, now)),
  };
}