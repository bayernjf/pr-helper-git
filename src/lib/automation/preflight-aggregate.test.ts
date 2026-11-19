// Board preflight aggregation tests: the old overview panel's totals badge —
// per-status sums across flows, and an aggregate pass only when every flow
// passed and every flow could be checked.
import { describe, expect, it } from 'vitest';
import { aggregateBoardPreflight, preflightCounts } from './preflight-aggregate';

function result(overrides: { workflowId?: string; ok?: boolean; findings?: Array<{ status: 'pass' | 'warn' | 'fail' | 'skip' }> } = {}) {
  return {
    workflowId: overrides.workflowId ?? 'w1',
    repository: 'octo/app',
    ok: overrides.ok ?? true,
    findings: overrides.findings ?? [],
  };
}

describe('preflightCounts', () => {
  it('counts fail/warn/pass and ignores skipped findings', () => {
    expect(preflightCounts([
      { status: 'fail' }, { status: 'fail' }, { status: 'warn' }, { status: 'pass' }, { status: 'skip' },
    ])).toEqual({ fail: 2, warn: 1, pass: 1 });
    expect(preflightCounts([])).toEqual({ fail: 0, warn: 0, pass: 0 });
  });
});

describe('aggregateBoardPreflight', () => {
  it('sums the per-flow counts into one badge and keeps a row per flow', () => {
    const summary = aggregateBoardPreflight([
      result({ workflowId: 'w1', findings: [{ status: 'fail' }, { status: 'pass' }] }),
      result({ workflowId: 'w2', ok: false, findings: [{ status: 'fail' }, { status: 'warn' }, { status: 'warn' }] }),
    ], []);
    expect(summary.totals).toEqual({ fail: 2, warn: 2, pass: 1 });
    expect(summary.ok).toBe(false);
    expect(summary.flows).toEqual([
      { workflowId: 'w1', repository: 'octo/app', ok: true, counts: { fail: 1, warn: 0, pass: 1 } },
      { workflowId: 'w2', repository: 'octo/app', ok: false, counts: { fail: 1, warn: 2, pass: 0 } },
    ]);
  });

  it('passes only when every flow is ok and no flow failed to check', () => {
    const clean = [result({ workflowId: 'w1' }), result({ workflowId: 'w2' })];
    expect(aggregateBoardPreflight(clean, []).ok).toBe(true);
    expect(aggregateBoardPreflight(clean, [{ workflowId: 'w3' }]).ok).toBe(false);
    expect(aggregateBoardPreflight([result({ ok: false })], []).ok).toBe(false);
  });

  it('reports an empty board as zero totals without blocking', () => {
    const summary = aggregateBoardPreflight([], []);
    expect(summary.totals).toEqual({ fail: 0, warn: 0, pass: 0 });
    expect(summary.ok).toBe(true);
    expect(summary.flows).toEqual([]);
  });
});