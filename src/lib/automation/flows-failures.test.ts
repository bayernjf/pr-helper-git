// Failure center semantics tests (P3-5): the three aggregated sections and
// the total counter mirror pr-helper failureCenterPanel.
import { describe, expect, it } from 'vitest';
import { blockedAutomation, failureSections, recoveryBadge } from './flows-failures';
import type { BoardState, RecoveryStatusRow, WorkflowStageStateRow } from './flows-board';

const FLOW = { id: 'flow-f', name: '失败通道', repository: 'octo/f', stages: [] };

function state(overrides: Partial<BoardState>): BoardState {
  return {
    workflows: [FLOW],
    states: [],
    actionQueue: [],
    automationActions: [],
    ...overrides,
  };
}

function row(overrides: Partial<WorkflowStageStateRow>): WorkflowStageStateRow {
  return { workflowId: 'flow-f', stageIndex: 0, source: 'dev', target: 'main', ...overrides };
}

describe('failureSections', () => {
  it('aggregates check failures and approvals from the queue', () => {
    const sections = failureSections(state({
      actionQueue: [
        { workflowId: 'flow-f', stageIndex: 0, source: 'dev', target: 'main', kind: 'checks-failed', message: 'CI 红', pullNumber: 9, workflowName: '失败通道' },
        { workflowId: 'flow-f', stageIndex: 1, source: 'main', target: 'prod', kind: 'needs-approval', message: '等审批' },
        // create-pr items are not failures
        { workflowId: 'flow-f', stageIndex: 2, source: 'x', target: 'y', kind: 'create-pr' },
      ],
    }));
    expect(sections.items).toHaveLength(2);
    expect(sections.items[0]).toMatchObject({ tone: 'failed', icon: '✗', pullNumber: 9 });
    expect(sections.items[1]).toMatchObject({ tone: 'attention', icon: '⏳' });
    expect(sections.total).toBe(2);
  });

  it('collects post-merge deployment failures from the projection', () => {
    const sections = failureSections(state({
      states: [
        row({ pullState: 'merged', checksState: 'failure' }),
        // open + failing checks belongs to the queue, not this section
        row({ stageIndex: 1, stageId: 's-2', source: 'prod', pullState: 'open', checksState: 'failure' }),
      ],
    }));
    expect(sections.deployItems).toHaveLength(1);
    expect(sections.deployItems[0].route).toBe('dev → main');
    expect(sections.deployItems[0].icon).toBe('🔴');
  });

  it('lists blocked automation actions with the takeover entry on paused create-pr', () => {
    const sections = failureSections(state({
      automationActions: [
        { workflowId: 'flow-f', stageIndex: 0, stageId: 's-1', source: 'dev', target: 'main', state: 'paused', kind: 'create-pr', message: 'AI 生成失败', id: 5 },
        { workflowId: 'flow-f', stageIndex: 0, stageId: 's-1', source: 'dev', target: 'main', state: 'failed', kind: 'merge-pr', id: 6 },
        // queued actions are moving, not blocked
        { workflowId: 'flow-f', stageIndex: 0, stageId: 's-1', source: 'dev', target: 'main', state: 'queued', kind: 'merge-pr', id: 7 },
      ],
    }));
    expect(sections.automationItems).toHaveLength(2);
    expect(sections.automationItems[0]).toMatchObject({ tone: 'attention', icon: '⏸', takeoverActionId: 5 });
    expect(sections.automationItems[1]).toMatchObject({ tone: 'failed', icon: '✗' });
    expect(sections.automationItems[1].takeoverActionId).toBeUndefined();
  });
});

describe('blockedAutomation', () => {
  it('only keeps paused/failed actions', () => {
    const actions = blockedAutomation(state({
      automationActions: [
        { workflowId: 'flow-f', stageIndex: 0, source: 'dev', state: 'paused' },
        { workflowId: 'flow-f', stageIndex: 0, source: 'dev', state: 'failed' },
        { workflowId: 'flow-f', stageIndex: 0, source: 'dev', state: 'running' },
        { workflowId: 'flow-f', stageIndex: 0, source: 'dev', state: 'queued' },
      ],
    }));
    expect(actions.map((a) => a.state)).toEqual(['paused', 'failed']);
  });
});

describe('recoveryBadge', () => {
  it('mirrors the original badge precedence', () => {
    const base: RecoveryStatusRow = { workflowId: 'f', stageIndex: 0, source: 'dev' };
    expect(recoveryBadge({ ...base, escalationNeeded: true })).toContain('escalation');
    expect(recoveryBadge({ ...base, exhausted: true, maxRetries: 3 })).toContain('exhausted (3)');
    expect(recoveryBadge({ ...base, cooldownRemainingSeconds: 45 })).toContain('45s');
    expect(recoveryBadge({ ...base, retryCount: 1, maxRetries: 3 })).toContain('1/3');
    expect(recoveryBadge(base)).toBeNull();
  });
});
