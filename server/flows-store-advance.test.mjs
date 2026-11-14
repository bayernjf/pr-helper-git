// D-015 round-trip: auto-advance must survive the store's relational
// serialization (write via automationColumns, read via automationFromRow).
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';

import { workflowToRows, workflowFromRows } from './workflows-store.mjs';

const WORKFLOW = {
  id: 'adv-1', name: '推进通道', repository: 'octo/adv', version: 3,
  stages: [{
    source: 'dev', target: 'main', stageId: 's-adv-1',
    automation: {
      autoCreatePullRequest: true, autoMergePullRequest: true,
      executionMode: 'server', triggerMinCommits: 2, autoAdvanceNext: true,
      generationRule: { name: '默认规则', capturedAt: '2026-11-14T00:00:00.000Z' },
    },
  }],
};

describe('auto-advance persistence (D-015)', () => {
  it('survives workflowToRows -> workflowFromRows round-trip', () => {
    const rows = workflowToRows(111, WORKFLOW);
    expect(rows.stages[0].auto_advance).toBe(true);
    const restored = workflowFromRows({ workflow: rows.workflow, stages: rows.stages, deployments: [] });
    const stage = restored.stages[0];
    expect(stage.automation.autoAdvanceNext).toBe(true);
  });

  it('keeps the flag off when unset', () => {
    const without = { ...WORKFLOW, stages: [{ source: 'dev', target: 'main', stageId: 's-x' }] };
    const rows = workflowToRows(111, without);
    expect(rows.stages[0].auto_advance).toBeNull();
    const restored = workflowFromRows({ workflow: rows.workflow, stages: rows.stages, deployments: [] });
    expect(restored.stages[0].automation?.autoAdvanceNext).toBeUndefined();
  });

  it('the applied migration 048 exists on disk for the deployment runbook', () => {
    const out = execFileSync('grep', ['-rl', 'ADD COLUMN IF NOT EXISTS auto_advance', 'scripts/migration/local-migrations/'], { encoding: 'utf8' });
    expect(out.trim()).toContain('048_auto_advance.sql');
  });
});
