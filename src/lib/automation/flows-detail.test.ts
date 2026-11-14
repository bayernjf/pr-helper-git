// Flow detail semantics tests (P3-2): per-stage state decisions mirror
// pr-helper detail.ts stageTimeline, the progress bar counts only an unbroken
// succeeded prefix, and dynamic routes render their matched branches.
import { describe, expect, it } from 'vitest';
import { buildStageDetails, flowProgress, type StageEventRow } from './flows-detail';
import type { Workflow } from './workflow';
import type { BoardState, WorkflowStageStateRow } from './flows-board';

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

describe('buildStageDetails', () => {
  it('renders a not-created stage with the waiting copy and its ahead-by gate', () => {
    const [stage] = buildStageDetails(stateWith([
      row({ stageId: 's-d-1' }),
    ]), FLOW, []);
    expect(stage.stateText).toBe('waiting to create a PR');
    expect(stage.tone).toBe('idle');
    expect(stage.pullNumber).toBeNull();
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
});
