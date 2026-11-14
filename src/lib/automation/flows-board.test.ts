// Flow board semantics tests (P3-1): the ported pr-helper board rules —
// aggregate counters, filter behaviour, step tone precedence and the run
// summary — asserted against fixtures that mirror the original semantics.
import { describe, expect, it } from 'vitest';
import {
  actionKey,
  boardCounts,
  buildLaneModels,
  laneStepModel,
  visibleWorkflows,
  type ActionQueueItem,
  type AutomationActionRow,
  type BoardState,
  type WorkflowStageStateRow,
} from './flows-board';
import type { Workflow } from './workflow';
import { matchingStageProjections } from './workflow';

const FLOW_A: Workflow = {
  id: 'flow-a',
  name: '主干发布',
  repository: 'octo/app',
  stages: [
    { source: 'feature', target: 'dev', stageId: 's-a-1' },
    { source: 'dev', target: 'main', stageId: 's-a-2' },
  ],
};
const FLOW_B: Workflow = {
  id: 'flow-b',
  name: '热修通道',
  repository: 'octo/hotfix',
  stages: [{ source: 'fix', target: 'main', stageId: 's-b-1' }],
};
const FLOW_ARCHIVED: Workflow = {
  id: 'flow-old',
  name: '旧通道',
  repository: 'octo/old',
  stages: [{ source: 'x', target: 'y', stageId: 's-old-1' }],
  archived: true,
};

function stateRow(overrides: Partial<WorkflowStageStateRow>): WorkflowStageStateRow {
  return { workflowId: '', stageIndex: 0, source: '', target: '', ...overrides };
}

function baseState(overrides: Partial<BoardState> = {}): BoardState {
  return {
    workflows: [FLOW_A, FLOW_B, FLOW_ARCHIVED],
    states: [],
    actionQueue: [],
    automationActions: [],
    ...overrides,
  };
}

describe('boardCounts', () => {
  it('counts attention as the whole action queue and failed as its checks-failed subset', () => {
    const queue: ActionQueueItem[] = [
      { workflowId: 'flow-a', stageIndex: 0, source: 'feature', kind: 'checks-failed' },
      { workflowId: 'flow-a', stageIndex: 1, source: 'dev', kind: 'needs-approval' },
    ];
    const counts = boardCounts(baseState({ actionQueue: queue }));
    expect(counts.attention).toBe(2);
    expect(counts.failed).toBe(1);
    expect(counts.active).toBe(2); // archived lanes are not active
    expect(counts.archived).toBe(1);
  });

  it("counts 'running' as attention ∪ lanes whose current stage tone is running", () => {
    // flow-b's only stage is mid-PR with running checks; flow-a is in the queue.
    const states = [
      stateRow({ workflowId: 'flow-b', stageIndex: 0, stageId: 's-b-1', source: 'fix', target: 'main', pullState: 'open', checksState: 'running', pullNumber: 9 }),
    ];
    const counts = boardCounts(baseState({
      states,
      actionQueue: [{ workflowId: 'flow-a', stageIndex: 0, source: 'feature', kind: 'create-pr' }],
    }));
    expect(counts.running).toBe(2);
    expect(counts.attention).toBe(1);
  });

  it('counts automation-blocked lanes once per blocked action presence', () => {
    const blocked: AutomationActionRow[] = [
      { workflowId: 'flow-a', stageIndex: 0, stageId: 's-a-1', source: 'feature', state: 'paused' },
      { workflowId: 'flow-a', stageIndex: 0, stageId: 's-a-1', source: 'feature', state: 'failed' },
    ];
    const counts = boardCounts(baseState({ automationActions: blocked }));
    expect(counts.automationBlocked).toBe(2);
  });
});

describe('visibleWorkflows', () => {
  const states = [
    stateRow({ workflowId: 'flow-b', stageIndex: 0, stageId: 's-b-1', source: 'fix', target: 'main', pullState: 'open', checksState: 'running', pullNumber: 9 }),
  ];

  it("filter 'attention' matches any action-queue presence, 'failed' only checks-failed items", () => {
    const state = baseState({
      states,
      actionQueue: [
        { workflowId: 'flow-a', stageIndex: 0, source: 'feature', kind: 'needs-approval' },
        { workflowId: 'flow-b', stageIndex: 0, source: 'fix', kind: 'checks-failed' },
      ],
    });
    expect(visibleWorkflows(state, 'attention', '').map((f) => f.id)).toEqual(['flow-a', 'flow-b']);
    expect(visibleWorkflows(state, 'failed', '').map((f) => f.id)).toEqual(['flow-b']);
  });

  it("filter 'archived' is the only view showing archived lanes", () => {
    expect(visibleWorkflows(baseState(), 'all', '').map((f) => f.id)).not.toContain('flow-old');
    expect(visibleWorkflows(baseState(), 'archived', '').map((f) => f.id)).toEqual(['flow-old']);
  });

  it("filter 'automation' matches lanes with a blocked action", () => {
    const state = baseState({
      automationActions: [
        { workflowId: 'flow-b', stageIndex: 0, stageId: 's-b-1', source: 'fix', state: 'paused' },
      ],
    });
    expect(visibleWorkflows(state, 'automation', '').map((f) => f.id)).toEqual(['flow-b']);
  });

  it('searches name and repository case-insensitively', () => {
    expect(visibleWorkflows(baseState(), 'all', 'OCTO/APP').map((f) => f.id)).toEqual(['flow-a']);
    expect(visibleWorkflows(baseState(), 'all', '热修').map((f) => f.id)).toEqual(['flow-b']);
    expect(visibleWorkflows(baseState(), 'all', 'zzz')).toEqual([]);
  });
});

describe('laneStepModel', () => {
  it('lets a checks-failed queue item override the projection tone to failed', () => {
    const state = baseState({
      actionQueue: [{ workflowId: 'flow-a', stageIndex: 0, source: 'feature', kind: 'checks-failed', message: 'CI 红' }],
    });
    const step = laneStepModel(state, FLOW_A, 0);
    expect(step.tone).toBe('failed');
    expect(step.label).toBe('CI 红');
  });

  it('tones any other queue item attention, keeping its message', () => {
    const state = baseState({
      actionQueue: [{ workflowId: 'flow-a', stageIndex: 0, source: 'feature', kind: 'create-pr', message: '正在创建 PR' }],
    });
    const step = laneStepModel(state, FLOW_A, 0);
    expect(step.tone).toBe('attention');
    expect(step.label).toBe('正在创建 PR');
  });

  it('falls back to the persisted projection tone when nothing is queued', () => {
    const state = baseState({
      states: [stateRow({ workflowId: 'flow-a', stageIndex: 0, stageId: 's-a-1', source: 'feature', target: 'dev', pullState: 'open', checksState: 'running', pullNumber: 3 })],
    });
    // The original routeCards() feeds each persisted route into laneStep.
    const [route] = matchingStageProjections(FLOW_A, 0, state.states);
    const step = laneStepModel(state, FLOW_A, 0, route);
    expect(step.tone).toBe('running');
    expect(step.pullNumber).toBe(3);
    expect(step.label).toContain('#3');
  });

  it('renders an idle waiting-for-changes step for a stage without projection', () => {
    const step = laneStepModel(baseState(), FLOW_A, 1);
    expect(step.tone).toBe('idle');
    expect(step.pullNumber).toBeNull();
  });
});

describe('buildLaneModels', () => {
  it('walks every stage in order and keeps the run summary on the first unfinished stage', () => {
    const state = baseState({
      states: [
        stateRow({ workflowId: 'flow-a', stageIndex: 0, stageId: 's-a-1', source: 'feature', target: 'dev', pullState: 'merged', checksState: 'success', pullNumber: 1 }),
        stateRow({ workflowId: 'flow-a', stageIndex: 1, stageId: 's-a-2', source: 'dev', target: 'main', pullState: 'open', checksState: 'running', pullNumber: 2 }),
      ],
    });
    const lanes = buildLaneModels(state, 'all', '');
    expect(lanes).toHaveLength(2);
    const lane = lanes.find((l) => l.workflow.id === 'flow-a')!;
    expect(lane.steps).toHaveLength(2);
    expect(lane.summary.stageIndex).toBe(1);
    expect(lane.summary.tone).toBe('running');
  });
});

describe('actionKey', () => {
  it('is stable per workflow/stage/source for resolve marks', () => {
    expect(actionKey({ workflowId: 'w', stageIndex: 2, source: 'dev' })).toBe('w:2:dev');
    expect(actionKey({ workflowId: 'w', stageIndex: null, source: 'dev' })).toBe('w:-1:dev');
  });
});
