// P3-13 flow preflight semantics: six read-only checks, each with a fix hint.
// These tests exercise the pure evaluator used by /api/flows/preflight; they
// do not need Postgres or GitHub.
import { describe, expect, it } from 'vitest';
import { workflowPreflight } from './workflows-store.mjs';

const deployment = {
  target: 'main',
  provider: 'vercel' as const,
  workflowName: 'Deploy frontend',
  environment: 'production' as const,
  githubEnvironment: 'production-vercel',
};

function baseWorkflow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'w1',
    name: 'Release',
    repository: 'octo/app',
    stages: [{ source: 'dev', target: 'main', stageId: 's-1' }],
    deployments: [deployment],
    ...overrides,
  };
}

function state(overrides: Record<string, unknown> = {}) {
  return {
    workflowId: 'w1',
    stageIndex: 0,
    source: 'dev',
    target: 'main',
    pullNumber: 12,
    pullState: 'open',
    mergeable: true,
    mergeableState: 'clean',
    ...overrides,
  };
}

function remote(overrides: Record<string, unknown> = {}) {
  return {
    installationId: '149185475',
    branchesAvailable: true,
    branches: ['dev', 'main', 'release/1.0'],
    actionsAvailable: true,
    workflows: [{ name: 'Deploy frontend', path: '.github/workflows/deploy.yml' }],
    environmentsAvailable: true,
    environments: ['production-vercel'],
    ...overrides,
  };
}

function byCategory(result: ReturnType<typeof workflowPreflight>, category: string) {
  return result.findings.filter((finding) => finding.category === category);
}

describe('workflowPreflight (P3-13)', () => {
  it('passes all six checks when app, branches, PR, Actions and Environment resolve', () => {
    const result = workflowPreflight(baseWorkflow(), [state()], remote());
    expect(result.ok).toBe(true);
    expect(new Set(result.findings.map((finding) => finding.category))).toEqual(
      new Set(['app', 'branch', 'pr', 'dependency', 'actions', 'environment']),
    );
    expect(result.findings.every((finding) => finding.status === 'pass')).toBe(true);
  });

  it('matches wildcard source rules against existing branches', () => {
    const workflow = baseWorkflow({
      stages: [{ source: 'release/*', target: 'main', stageId: 's-1' }],
    });
    const result = workflowPreflight(workflow, [state({ source: 'release/1.0' })], remote());
    expect(result.ok).toBe(true);
    expect(byCategory(result, 'branch')[0].status).toBe('pass');
  });

  it('fails a dirty PR, a missing branch, a missing dependency and missing Actions/Environment', () => {
    const workflow = baseWorkflow({
      stages: [
        { source: 'dev', target: 'main', stageId: 's-1' },
        { source: 'feature', target: 'main', stageId: 's-2', waitFor: [0] },
      ],
    });
    const result = workflowPreflight(
      workflow,
      [state({ mergeable: false, mergeableState: 'dirty' })],
      remote({
        branches: ['develop'],
        workflows: [],
        environments: [],
        environmentsAvailable: true,
      }),
    );
    expect(result.ok).toBe(false);
    expect(byCategory(result, 'branch').some((finding) => finding.code === 'target-missing')).toBe(true);
    expect(byCategory(result, 'branch').some((finding) => finding.code === 'source-missing')).toBe(true);
    expect(byCategory(result, 'pr')[0]).toMatchObject({ status: 'fail', code: 'pull-conflict' });
    expect(byCategory(result, 'dependency')[0]).toMatchObject({ status: 'fail' });
    expect(byCategory(result, 'actions').some((finding) => finding.code === 'workflow-missing')).toBe(true);
    expect(byCategory(result, 'environment')[0]).toMatchObject({ status: 'fail', code: 'environment-missing' });
  });

  it('skips branch checks and fails app access when credentials are absent', () => {
    const result = workflowPreflight(baseWorkflow(), [], remote({
      installationId: undefined,
      branchesAvailable: false,
      actionsAvailable: false,
      environmentsAvailable: false,
    }));
    expect(result.ok).toBe(false);
    expect(byCategory(result, 'app')[0]).toMatchObject({ status: 'fail', code: 'app-not-configured' });
    expect(byCategory(result, 'branch')[0]).toMatchObject({ status: 'skip' });
    expect(byCategory(result, 'actions')[0]).toMatchObject({ status: 'fail', code: 'actions-unavailable' });
    expect(byCategory(result, 'environment')[0]).toMatchObject({ status: 'warn', code: 'environments-unreadable' });
  });

  it('warns when GitHub has not computed mergeability yet', () => {
    const result = workflowPreflight(baseWorkflow(), [state({ mergeable: null, mergeableState: 'unknown' })], remote());
    expect(result.ok).toBe(true);
    expect(byCategory(result, 'pr')[0]).toMatchObject({ status: 'warn', code: 'pull-unknown' });
  });
});
