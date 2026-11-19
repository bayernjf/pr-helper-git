// Resolve-mark semantics tests: the ported pr-helper markAutomationResolved /
// isAutomationResolved / reconcile rules — TTL, fresh-event re-surfacing,
// wildcard coverage, prune-on-read and the board-only filtered view.
import { describe, expect, it } from 'vitest';
import {
  RESOLVED_AUTOMATION_TTL_MS,
  automationStepKey,
  isAutomationResolved,
  markResolved,
  pruneResolvedMarks,
  resolvedBoardState,
  resolvedSourceMatches,
  type ResolvedMarks,
} from './resolved-automation';
import type { ActionQueueItem, AutomationActionRow, BoardState } from './flows-board';

const NOW = 1_700_000_000_000;
const EMPTY: ResolvedMarks = new Map();

function action(overrides: Partial<AutomationActionRow> = {}): AutomationActionRow {
  return {
    workflowId: 'flow-a',
    stageIndex: 0,
    source: 'feature',
    kind: 'create-pr',
    state: 'paused',
    id: 1,
    updatedAt: '2026-11-18T00:00:00Z',
    ...overrides,
  };
}

function queueItem(overrides: Partial<ActionQueueItem> = {}): ActionQueueItem {
  return { workflowId: 'flow-a', stageIndex: 0, source: 'feature', kind: 'checks-failed', ...overrides };
}

function baseState(overrides: Partial<BoardState> = {}): BoardState {
  return { workflows: [], states: [], actionQueue: [], automationActions: [], ...overrides };
}

describe('resolvedSourceMatches', () => {
  it('matches exact sources and lets a wildcard mark cover concrete routes', () => {
    expect(resolvedSourceMatches('feature', 'feature')).toBe(true);
    expect(resolvedSourceMatches('feature', 'dev')).toBe(false);
    expect(resolvedSourceMatches('release/*', 'release/1.2')).toBe(true);
    expect(resolvedSourceMatches('release/*', 'feature')).toBe(false);
  });

  it('does not treat a wildcard candidate as a rule (the old swapped-args bug)', () => {
    expect(resolvedSourceMatches('release/1.2', 'release/*')).toBe(false);
  });
});

describe('markResolved', () => {
  it('records the newest action on the route without mutating the input map', () => {
    const actions = [
      action({ id: 1, updatedAt: '2026-11-18T00:00:00Z' }),
      action({ id: 2, updatedAt: '2026-11-18T01:00:00Z' }),
    ];
    const marks = markResolved(EMPTY, actions, 'flow-a', 0, 'feature', NOW);
    expect(marks.get(automationStepKey('flow-a', 0, 'feature'))).toEqual({
      resolvedAt: NOW,
      source: 'feature',
      actionId: 2,
      updatedAt: '2026-11-18T01:00:00Z',
    });
    expect(EMPTY.size).toBe(0);
  });

  it('records a null action when the route has no automation row (queue-only work)', () => {
    const marks = markResolved(EMPTY, [], 'flow-a', 0, 'feature', NOW);
    expect(marks.get(automationStepKey('flow-a', 0, 'feature'))?.actionId).toBeNull();
  });
});

describe('isAutomationResolved', () => {
  it('hides the exact row that was just handled', () => {
    const actions = [action()];
    const marks = markResolved(EMPTY, actions, 'flow-a', 0, 'feature', NOW);
    expect(isAutomationResolved(marks, actions, 'flow-a', 0, 'feature', NOW)).toBe(true);
    expect(isAutomationResolved(marks, actions, 'flow-a', 1, 'feature', NOW)).toBe(false);
    expect(isAutomationResolved(marks, actions, 'flow-b', 0, 'feature', NOW)).toBe(false);
    expect(isAutomationResolved(marks, actions, 'flow-a', 0, 'dev', NOW)).toBe(false);
  });

  it('expires after the TTL', () => {
    const actions = [action()];
    const marks = markResolved(EMPTY, actions, 'flow-a', 0, 'feature', NOW);
    expect(isAutomationResolved(marks, actions, 'flow-a', 0, 'feature', NOW + RESOLVED_AUTOMATION_TTL_MS)).toBe(true);
    expect(isAutomationResolved(marks, actions, 'flow-a', 0, 'feature', NOW + RESOLVED_AUTOMATION_TTL_MS + 1)).toBe(false);
  });

  it('re-surfaces the route when a different or newer action row appears', () => {
    const actions = [action()];
    const marks = markResolved(EMPTY, actions, 'flow-a', 0, 'feature', NOW);
    const newer = [action({ updatedAt: '2026-11-18T01:00:00Z' })];
    const replaced = [action({ id: 9 })];
    expect(isAutomationResolved(marks, newer, 'flow-a', 0, 'feature', NOW)).toBe(false);
    expect(isAutomationResolved(marks, replaced, 'flow-a', 0, 'feature', NOW)).toBe(false);
  });

  it('lets a wildcard mark cover queue-only concrete routes, but a live row there is a fresh event', () => {
    const marks = markResolved(EMPTY, [], 'flow-a', 0, 'release/*', NOW);
    expect(isAutomationResolved(marks, [], 'flow-a', 0, 'release/1.2', NOW)).toBe(true);
    const live = [action({ source: 'release/1.2', id: 5 })];
    expect(isAutomationResolved(marks, live, 'flow-a', 0, 'release/1.2', NOW)).toBe(false);
  });
});

describe('pruneResolvedMarks', () => {
  it('returns the same map while the server still reports the work as pending', () => {
    const actions = [action()];
    const marks = markResolved(EMPTY, actions, 'flow-a', 0, 'feature', NOW);
    expect(pruneResolvedMarks(marks, baseState({ automationActions: actions }), NOW)).toBe(marks);
  });

  it('keeps a mark whose only remaining signal is an attention-queue item', () => {
    const marks = markResolved(EMPTY, [], 'flow-a', 0, 'feature', NOW);
    const state = baseState({ actionQueue: [queueItem()] });
    expect(pruneResolvedMarks(marks, state, NOW)).toBe(marks);
  });

  it('drops the mark once the projection is no longer blocked and the queue is clear', () => {
    const actions = [action()];
    const marks = markResolved(EMPTY, actions, 'flow-a', 0, 'feature', NOW);
    const caughtUp = baseState({ automationActions: [action({ state: 'queued' })] });
    const pruned = pruneResolvedMarks(marks, caughtUp, NOW);
    expect(pruned.size).toBe(0);
    expect(pruned).not.toBe(marks);
  });

  it('drops expired and superseded marks', () => {
    const actions = [action()];
    const marks = markResolved(EMPTY, actions, 'flow-a', 0, 'feature', NOW);
    expect(pruneResolvedMarks(marks, baseState({ automationActions: actions }), NOW + RESOLVED_AUTOMATION_TTL_MS + 1).size).toBe(0);
    const newer = baseState({ automationActions: [action({ updatedAt: '2026-11-18T01:00:00Z' })] });
    expect(pruneResolvedMarks(marks, newer, NOW).size).toBe(0);
  });

  it('keeps a wildcard mark while a covered concrete route is still blocked', () => {
    const marks = markResolved(EMPTY, [], 'flow-a', 0, 'release/*', NOW);
    const state = baseState({ automationActions: [action({ source: 'release/1.2', id: 5 })] });
    expect(pruneResolvedMarks(marks, state, NOW)).toBe(marks);
  });
});

describe('resolvedBoardState', () => {
  it('returns the same state when there are no marks', () => {
    const state = baseState({ actionQueue: [queueItem()], automationActions: [action()] });
    expect(resolvedBoardState(state, EMPTY, NOW)).toBe(state);
  });

  it('filters covered queue items and automation rows only, leaving projections untouched', () => {
    const state = baseState({
      states: [{ workflowId: 'flow-a', stageIndex: 0, source: 'feature', target: 'dev' }],
      actionQueue: [queueItem(), queueItem({ source: 'dev', stageIndex: 1 })],
      automationActions: [action(), action({ source: 'dev', stageIndex: 1, id: 2 })],
    });
    const marks = markResolved(EMPTY, state.automationActions, 'flow-a', 0, 'feature', NOW);
    const view = resolvedBoardState(state, marks, NOW);
    expect(view.actionQueue.map((item) => item.source)).toEqual(['dev']);
    expect(view.automationActions.map((row) => row.source)).toEqual(['dev']);
    expect(view.states).toBe(state.states);
    expect(view.workflows).toBe(state.workflows);
  });

  it('lets a wildcard mark drop every covered queue-only route at once', () => {
    const state = baseState({
      actionQueue: [
        queueItem({ source: 'release/1.2' }),
        queueItem({ source: 'release/1.3' }),
        queueItem({ source: 'feature' }),
      ],
    });
    const marks = markResolved(EMPTY, [], 'flow-a', 0, 'release/*', NOW);
    const view = resolvedBoardState(state, marks, NOW);
    expect(view.actionQueue.map((item) => item.source)).toEqual(['feature']);
  });

  it('stops hiding once a fresh event replaces the handled row', () => {
    const state = baseState({ actionQueue: [queueItem()], automationActions: [action()] });
    const marks = markResolved(EMPTY, state.automationActions, 'flow-a', 0, 'feature', NOW);
    const fresh = baseState({
      actionQueue: [queueItem()],
      automationActions: [action({ id: 9, updatedAt: '2026-11-18T01:00:00Z' })],
    });
    const view = resolvedBoardState(fresh, marks, NOW);
    expect(view.actionQueue).toHaveLength(1);
    expect(view.automationActions).toHaveLength(1);
  });
});