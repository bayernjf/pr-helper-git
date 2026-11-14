import { describe, expect, it } from 'vitest';
import { flowAuditCsv, flowAuditSummary } from './flow-audit';
import type { FlowAuditEntry } from '../../api/flows';

const base: FlowAuditEntry = {
  id: 1,
  action: 'deployment-rollback',
  outcome: 'success',
  repository: 'octo/app',
  workflowId: 'wf',
  stageId: 's1',
  source: 'dev',
  target: 'main',
  pullNumber: 42,
  runId: 7,
  metadata: { provider: 'vercel' },
  failureReason: 'deploy failed, retry',
  occurredAt: '2026-11-14T12:00:00.000Z',
};

describe('flowAuditCsv', () => {
  it('exports a fixed header and quoted cells', () => {
    const csv = flowAuditCsv([base]);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('occurredAt,action,outcome,repository,workflowId,stageId,source,target,pullNumber,runId,failureReason,metadata');
    expect(lines[1]).toContain('"deploy failed, retry"');
    expect(lines[1]).toContain('"{""provider"":""vercel""}"');
  });

  it('escapes embedded quotes and newlines', () => {
    const csv = flowAuditCsv([{ ...base, failureReason: 'a "b"\nc' }]);
    expect(csv).toContain('"a ""b""\nc"');
  });

  it('handles an empty list', () => {
    expect(flowAuditCsv([]).split('\r\n')).toHaveLength(1);
  });
});

describe('flowAuditSummary', () => {
  it('joins identifying fields', () => {
    expect(flowAuditSummary(base)).toBe('octo/app · s1 · #42 · run 7');
  });
});
