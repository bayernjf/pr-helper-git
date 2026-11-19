// Flow detail semantics tests (P3-2): per-stage state decisions mirror
// pr-helper detail.ts stageTimeline, the progress bar counts only an unbroken
// succeeded prefix, and dynamic routes render their matched branches.
import { describe, expect, it } from 'vitest';
import {
  buildStageDetails,
  flowProgress,
  nextActionSummary,
  stageProgressStatus,
  stageProgressTooltip,
  type StageEventRow,
} from './flows-detail';
import type { Workflow } from './workflow';
import type { AutomationActionRow, BoardState, WorkflowStageStateRow } from './flows-board';

const FLOW: Workflow = {
  id: 'flow-d',
  name: '详情通道',
  repository: 'octo/detail',
  stages: [
    { source: 'feature', target: 'dev', stageId: 's-d-1' },
    { source: 'dev', target: 'main', stageId: 's-d-2' },
  ],
};

const DYNAMIC: Workflow = {
  id: 'flow-x',
  name: '发布窗',
  repository: 'octo/win',
  stages: [{ source: 'release/*', target: 'main', stageId: 's-x-1' }],
};

function row(overrides: Partial<WorkflowStageStateRow>): WorkflowStageStateRow {
  return { workflowId: 'flow-d', stageIndex: 0, source: 'feature', target: 'dev', ...overrides };
}

function stateWith(states: WorkflowStageStateRow[]): BoardState {
  return { workflows: [FLOW, DYNAMIC], states, actionQueue: [], automationActions: [] };
}

function action(overrides: Partial<AutomationActionRow>): AutomationActionRow {
  return {
    workflowId: 'flow-d', stageIndex: 0, source: 'feature', kind: 'merge-pr',
    state: 'queued', updatedAt: '2026-11-14T01:00:00Z', ...overrides,
  };
}

describe('buildStageDetails', () => {
  it('renders a not-created stage with the waiting copy and its ahead-by gate', () => {
    const [stage] = buildStageDetails(stateWith([
      row({ stageId: 's-d-1' }),
    ]), FLOW, []);
    expect(stage.stateText).toBe('waiting to create a PR');
    expect(stage.tone).toBe('idle');
    expect(stage.pullNumber).toBeNull();
  });

  it('keeps an open pull visible on first paint when the projection has a head sha', () => {
    const [stage] = buildStageDetails(stateWith([
      row({
        stageId: 's-d-1', pullState: 'open', checksState: 'failure', pullNumber: 217,
        checksPassed: 6, checksTotal: 12, headSha: '5ac5f268b2f18f1748c9d16ed476ca4a04b18e13',
      }),
    ]), FLOW, []);
    expect(stage.stateText).toBe('checks failed');
    expect(stage.pullNumber).toBe(217);
    expect(stage.pullUrl).toBe('https://github.com/octo/detail/pull/217');
  });

  it('reports merged with post-merge verification on the persisted row', () => {
    const [stage] = buildStageDetails(stateWith([
      row({ stageId: 's-d-1', pullState: 'merged', checksState: 'success', pullNumber: 12, checksPassed: 5, checksTotal: 5 }),
    ]), FLOW, []);
    expect(stage.stateText).toBe('merged · post-merge checks passed');
    expect(stage.tone).toBe('succeeded');
    expect(stage.pullNumber).toBe(12);
    expect(stage.pullUrl).toBe('https://github.com/octo/detail/pull/12');
    expect(stage.gates).toEqual(['checks 5/5 checks passed']);
  });

  it('keeps post-merge failure loud', () => {
    const [stage] = buildStageDetails(stateWith([
      row({ stageId: 's-d-1', pullState: 'merged', checksState: 'failure', pullNumber: 13 }),
    ]), FLOW, []);
    expect(stage.stateText).toBe('merged · post-merge checks failed');
    expect(stage.tone).toBe('failed');
  });

  it('carries automation flags and threshold from the stage definition', () => {
    const flow: Workflow = {
      ...FLOW,
      stages: [{
        ...FLOW.stages[0],
        automation: {
          autoCreatePullRequest: true as const,
          triggerMinCommits: 4,
          executionMode: 'server',
          generationRule: { name: '默认规则', capturedAt: '2026-11-14T00:00:00.000Z' },
        },
      } as Workflow['stages'][number], FLOW.stages[1]],
    };
    const state: BoardState = { ...stateWith([]), workflows: [flow] };
    const [stage] = buildStageDetails(state, flow, []);
    expect(stage.automation).toEqual({ autoCreate: true, threshold: 4, autoMerge: false, autoAdvance: false });
  });

  it('filters the event stream down to this stage', () => {
    const events: StageEventRow[] = [
      { workflowId: 'flow-d', stageIndex: 0, message: 'PR 已创建', occurredAt: '2026-11-14T01:00:00Z' },
      { workflowId: 'flow-d', stageIndex: 1, message: '其他步骤', occurredAt: '2026-11-14T01:01:00Z' },
      { workflowId: 'flow-other', stageIndex: 0, message: '别的流程', occurredAt: '2026-11-14T01:02:00Z' },
    ];
    const [stage] = buildStageDetails(stateWith([row({ stageId: 's-d-1' })]), FLOW, events);
    expect(stage.events).toHaveLength(1);
    expect(stage.events[0].message).toBe('PR 已创建');
  });

  it('lists matched branches for a dynamic route stage', () => {
    const win: WorkflowStageStateRow = { workflowId: 'flow-x', stageIndex: 0, stageId: 's-x-1', source: 'release/1.2', target: 'main', pullState: 'open', checksState: 'running', pullNumber: 7 };
    const [stage] = buildStageDetails(stateWith([win]), DYNAMIC, []);
    expect(stage.dynamic).toBe(true);
    expect(stage.routes).toHaveLength(1);
    expect(stage.routes[0]).toMatchObject({ source: 'release/1.2', pullNumber: 7, tone: 'running' });
    expect(stage.routes[0].label).toBe('PR #7 checks running');
  });
});

describe('flowProgress', () => {
  it('counts only the unbroken succeeded prefix as completed', () => {
    const state = stateWith([
      row({ stageId: 's-d-1', pullState: 'merged', checksState: 'success', pullNumber: 1 }),
      // stage 2 merged but its post-merge checks failed — not succeeded
      row({ workflowId: 'flow-d', stageIndex: 1, stageId: 's-d-2', source: 'dev', target: 'main', pullState: 'merged', checksState: 'failure', pullNumber: 2 }),
    ]);
    const progress = flowProgress(state, FLOW);
    expect(progress.completed).toBe(1);
    expect(progress.total).toBe(2);
    expect(progress.currentIndex).toBe(1);
    // A later succeeded node behind the current step reads as idle.
    expect(progress.nodes).toEqual(['succeeded', 'failed']);
  });

  it('reports every stage done when all succeeded', () => {
    const state = stateWith([
      row({ stageId: 's-d-1', pullState: 'merged', checksState: 'success', pullNumber: 1 }),
      row({ workflowId: 'flow-d', stageIndex: 1, stageId: 's-d-2', source: 'dev', target: 'main', pullState: 'merged', checksState: 'success', pullNumber: 2 }),
    ]);
    expect(flowProgress(state, FLOW).completed).toBe(2);
  });

  it('reports not synced and no completed steps before any projection arrives', () => {
    const progress = flowProgress(stateWith([]), FLOW);
    expect(progress.synced).toBe(false);
    expect(progress.completed).toBe(0);
    expect(progress.currentIndex).toBe(0);
    expect(progress.syncedAt).toBeNull();
  });

  it('copies the server unlock reason into the next line and the newest updatedAt into syncedAt', () => {
    const state = stateWith([
      row({ stageId: 's-d-1', pullState: 'merged', checksState: 'success', pullNumber: 1, updatedAt: '2026-11-14T01:00:00Z', decision: { kind: 'merged' } }),
      row({
        workflowId: 'flow-d', stageIndex: 1, stageId: 's-d-2', source: 'dev', target: 'main',
        pullState: 'open', checksState: 'running', pullNumber: 2, headSha: 'abc',
        updatedAt: '2026-11-14T02:00:00Z',
        decision: { kind: 'needs-approval', message: 'awaiting 1 approval' },
      }),
    ]);
    const progress = flowProgress(state, FLOW);
    expect(progress.synced).toBe(true);
    expect(progress.completed).toBe(1);
    expect(progress.currentIndex).toBe(1);
    expect(progress.next).toEqual({ index: 1, reason: 'awaiting 1 approval' });
    expect(progress.syncedAt).toBe('2026-11-14T02:00:00Z');
  });

  it('points nowhere when every step succeeded', () => {
    const state = stateWith([
      row({ stageId: 's-d-1', decision: { kind: 'merged' } }),
      row({ workflowId: 'flow-d', stageIndex: 1, stageId: 's-d-2', source: 'dev', target: 'main', decision: { kind: 'merged' } }),
    ]);
    const progress = flowProgress(state, FLOW);
    expect(progress.currentIndex).toBeNull();
    expect(progress.next).toBeNull();
    expect(progress.completed).toBe(2);
  });
});

describe('stageProgressStatus', () => {
  function withDecision(decision: NonNullable<WorkflowStageStateRow['decision']>, extra: Partial<BoardState> = {}): BoardState {
    return { ...stateWith([row({ stageId: 's-d-1', decision })]), ...extra };
  }

  it('maps the server decision kinds onto node statuses', () => {
    expect(stageProgressStatus(withDecision({ kind: 'locked' }), FLOW, 0)).toBe('locked');
    expect(stageProgressStatus(withDecision({ kind: 'ready-to-merge' }), FLOW, 0)).toBe('ready');
    expect(stageProgressStatus(withDecision({ kind: 'ready-to-create' }), FLOW, 0)).toBe('ready');
    expect(stageProgressStatus(withDecision({ kind: 'needs-approval' }), FLOW, 0)).toBe('waiting-gates');
    expect(stageProgressStatus(withDecision({ kind: 'checks-failed' }), FLOW, 0)).toBe('failed');
    expect(stageProgressStatus(withDecision({ kind: 'merged' }), FLOW, 0)).toBe('succeeded');
    expect(stageProgressStatus(withDecision({ kind: 'merged', canCreateNext: true }), FLOW, 0)).toBe('ready');
  });

  it('folds the automation action over the decision', () => {
    const decision = { kind: 'ready-to-merge' } as const;
    expect(stageProgressStatus(withDecision(decision, { automationActions: [action({ state: 'paused' })] }), FLOW, 0)).toBe('blocked');
    expect(stageProgressStatus(withDecision(decision, { automationActions: [action({ state: 'failed' })] }), FLOW, 0)).toBe('failed');
    expect(stageProgressStatus(withDecision(decision, { automationActions: [action({ state: 'queued', failureReason: 'checks pending' })] }), FLOW, 0)).toBe('waiting-gates');
    expect(stageProgressStatus(withDecision(decision, { automationActions: [action({ state: 'running' })] }), FLOW, 0)).toBe('running');
  });

  it('takes the worst status across a dynamic stage’s matched routes', () => {
    const state = stateWith([
      { workflowId: 'flow-x', stageIndex: 0, stageId: 's-x-1', source: 'release/1.2', target: 'main', pullState: 'open', checksState: 'running', pullNumber: 7 },
      { workflowId: 'flow-x', stageIndex: 0, stageId: 's-x-1', source: 'release/1.3', target: 'main', pullState: 'open', checksState: 'failure', pullNumber: 8 },
    ]);
    expect(stageProgressStatus(state, DYNAMIC, 0)).toBe('failed');
  });

  it('reads an automation-only node when the stage has no projection yet', () => {
    const state: BoardState = { ...stateWith([]), automationActions: [action({ state: 'queued' })] };
    expect(stageProgressStatus(state, FLOW, 0)).toBe('running');
    expect(stageProgressStatus(stateWith([]), FLOW, 0)).toBe('idle');
  });

  it('keeps the projection-tone first paint when the row carries no decision', () => {
    const state = stateWith([
      row({ stageId: 's-d-1', pullState: 'merged', checksState: 'success', pullNumber: 1 }),
    ]);
    expect(stageProgressStatus(state, FLOW, 0)).toBe('succeeded');
  });
});

describe('stageProgressTooltip', () => {
  it('names the route, the decision message and the running automation', () => {
    const state: BoardState = {
      ...stateWith([row({ stageId: 's-d-1', decision: { kind: 'ready-to-merge', message: 'all gates green' } })]),
      automationActions: [action({ state: 'running', kind: 'merge-pr' })],
    };
    expect(stageProgressTooltip(state, FLOW, 0)).toBe('feature → dev · all gates green · Current action: auto-merge PR');
  });

  it('shows the failure reason instead of the action when the automation is blocked', () => {
    const state: BoardState = {
      ...stateWith([row({ stageId: 's-d-1', decision: { kind: 'checks-failed' } })]),
      automationActions: [action({ state: 'failed', failureReason: '  merge conflict  ' })],
    };
    const tooltip = stageProgressTooltip(state, FLOW, 0);
    expect(tooltip).toContain('merge conflict');
    expect(tooltip).not.toContain('Current action');
  });

  it('never speaks of automation when no server action exists', () => {
    const state = stateWith([row({ stageId: 's-d-1', decision: { kind: 'ready-to-merge' } })]);
    expect(stageProgressTooltip(state, FLOW, 0)).toBe('feature → dev');
  });
});

describe('nextActionSummary', () => {
  it('reports notStarted before any projection exists', () => {
    expect(nextActionSummary(stateWith([]), FLOW)).toBe('notStarted');
  });

  it('reports gateFailed when a dynamic route’s checks failed', () => {
    const state = stateWith([
      { workflowId: 'flow-x', stageIndex: 0, stageId: 's-x-1', source: 'release/1.2', target: 'main', pullState: 'open', checksState: 'failure', pullNumber: 7 },
    ]);
    expect(nextActionSummary(state, DYNAMIC)).toBe('gateFailed');
  });

  it('reports gateFailed when an open PR’s checks failed', () => {
    const state = stateWith([
      row({ stageId: 's-d-1', pullState: 'open', checksState: 'failure', pullNumber: 217, headSha: 'abc' }),
    ]);
    expect(nextActionSummary(state, FLOW)).toBe('gateFailed');
  });

  it('reports canCheck while a stage has no PR yet', () => {
    const state = stateWith([row({ stageId: 's-d-1' })]);
    expect(nextActionSummary(state, FLOW)).toBe('canCheck');
  });

  it('reports synced when every stage is merged and green', () => {
    const state = stateWith([
      row({ stageId: 's-d-1', pullState: 'merged', checksState: 'success', pullNumber: 1 }),
      row({ workflowId: 'flow-d', stageIndex: 1, stageId: 's-d-2', source: 'dev', target: 'main', pullState: 'merged', checksState: 'success', pullNumber: 2 }),
    ]);
    expect(nextActionSummary(state, FLOW)).toBe('synced');
  });
});
