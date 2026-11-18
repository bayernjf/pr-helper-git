// CI Health aggregation contract: PR-level rollup classification, window
// filtering, duplicate check-run severity, and the read-only summary shape.
import { describe, expect, it } from 'vitest';
import {
  buildCiHealth,
  classifyFailure,
  normalizeWindowDays,
  summarizeRollup,
} from './ci-health.mjs';

const NOW = Date.parse('2026-11-18T12:00:00.000Z');
const day = 86_400_000;

function checkRun(name, conclusion, status = 'COMPLETED') {
  return {
    __typename: 'CheckRun',
    name,
    status,
    conclusion,
    title: `${name} title`,
    detailsUrl: `https://github.com/example/actions/${name}`,
  };
}

function statusContext(context, state) {
  return {
    __typename: 'StatusContext',
    context,
    state,
    description: `${context} description`,
    targetUrl: `https://ci.example/${context}`,
  };
}

function rollup(contexts, state = '') {
  return { state, contexts: { nodes: contexts } };
}

function pr(number, overrides = {}) {
  const createdAt = new Date(NOW - 2 * day).toISOString();
  return {
    number,
    title: `PR ${number}`,
    state: 'OPEN',
    merged: false,
    mergedAt: null,
    createdAt,
    updatedAt: createdAt,
    url: `https://github.com/example/repo/pull/${number}`,
    isDraft: false,
    headRefOid: `sha-${number}`,
    commits: [{ oid: `sha-${number}`, statusCheckRollup: rollup([checkRun('ci/test', 'SUCCESS')], 'SUCCESS') }],
    ...overrides,
  };
}

describe('normalizeWindowDays', () => {
  it('clamps to the exposed 7/30/90-day windows', () => {
    expect(normalizeWindowDays(1)).toBe(7);
    expect(normalizeWindowDays('7')).toBe(7);
    expect(normalizeWindowDays(31)).toBe(90);
    expect(normalizeWindowDays('nope')).toBe(30);
    expect(normalizeWindowDays(undefined)).toBe(30);
  });
});

describe('classifyFailure', () => {
  it('maps check names and details onto stable categories', () => {
    expect(classifyFailure('Production runner watchdog')).toBe('infra');
    expect(classifyFailure('job timed out after 20m')).toBe('timeout');
    expect(classifyFailure('403 permission denied')).toBe('auth');
    expect(classifyFailure('Vercel deploy')).toBe('deploy');
    expect(classifyFailure('npm ci failed')).toBe('deps');
    expect(classifyFailure('eslint / typecheck')).toBe('lint');
    expect(classifyFailure('vitest assertions')).toBe('tests');
    expect(classifyFailure('desktop:build')).toBe('build');
    expect(classifyFailure('')).toBe('unknown');
  });
});

describe('summarizeRollup', () => {
  it('treats a failed check as failure and dedupes by highest severity', () => {
    const summary = summarizeRollup(
      rollup([
        checkRun('ci/test', 'SUCCESS'),
        checkRun('ci/test', 'FAILURE'),
        statusContext('lint', 'success'),
      ]),
    );
    expect(summary.state).toBe('failure');
    expect(summary.total).toBe(2);
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0]).toMatchObject({ name: 'ci/test', category: 'tests' });
  });

  it('reports pending and empty rollups separately', () => {
    const pending = summarizeRollup(
      rollup([
        checkRun('ci/test', '', 'IN_PROGRESS'),
        checkRun('build', 'SUCCESS'),
      ]),
    );
    expect(pending.state).toBe('pending');
    expect(pending.total).toBe(2);

    const empty = summarizeRollup(rollup([]));
    expect(empty).toMatchObject({ state: 'none', total: 0, failed: [] });
  });
});

describe('buildCiHealth', () => {
  it('counts PR-level results, keeps open PRs outside the window, and separates post-merge CI', () => {
    const repoA = {
      repository: 'example/repo-a',
      defaultBranch: 'main',
      defaultBranchSha: 'main-sha',
      defaultBranchRollup: rollup([checkRun('desktop:build', 'FAILURE')]),
      pullRequests: [
        pr(1, {
          commits: [{
            oid: 'sha-1',
            statusCheckRollup: rollup([
              checkRun('ci/test', 'FAILURE'),
              checkRun('build', 'SUCCESS'),
            ]),
          }],
        }),
        pr(2, {
          state: 'MERGED',
          merged: true,
          mergedAt: new Date(NOW - 1 * day).toISOString(),
          createdAt: new Date(NOW - 10 * day).toISOString(),
        }),
        pr(3, {
          state: 'CLOSED',
          createdAt: new Date(NOW - 40 * day).toISOString(),
        }),
        pr(4, { commits: [] }),
        pr(5, {
          createdAt: new Date(NOW - 9 * day).toISOString(),
          commits: [{
            oid: 'sha-5',
            statusCheckRollup: rollup([checkRun('ci/test', '', 'IN_PROGRESS')]),
          }],
        }),
      ],
    };
    const repoB = {
      repository: 'example/repo-b',
      defaultBranch: 'main',
      defaultBranchRollup: rollup([checkRun('ci/test', 'SUCCESS')], 'SUCCESS'),
      pullRequests: [
        pr(6, { createdAt: new Date(NOW - 35 * day).toISOString() }),
      ],
    };

    const report = buildCiHealth({
      repoGraphs: [repoA, repoB],
      days: 30,
      now: NOW,
      scannedRepos: 2,
    });

    expect(report.windowDays).toBe(30);
    expect(report.totals).toMatchObject({
      prCount: 4,
      passed: 2,
      failed: 1,
      pending: 1,
      blocked: 1,
      postMergeFailures: 1,
      reposWithPrs: 2,
      scannedRepos: 2,
      passRate: 66.7,
      failureRate: 33.3,
    });
    expect(report.repos.map((repo) => repo.repository)).toEqual([
      'example/repo-a',
      'example/repo-b',
    ]);
    expect(report.failedPrs).toHaveLength(1);
    expect(report.failedPrs[0]).toMatchObject({
      repository: 'example/repo-a',
      number: 1,
      ciState: 'failure',
      failedChecks: [expect.objectContaining({ name: 'ci/test', category: 'tests' })],
    });
    expect(report.failureCategories).toEqual([
      expect.objectContaining({ id: 'tests', count: 1, share: 100 }),
    ]);
    expect(report.repos[0].postMerge).toMatchObject({
      state: 'failure',
      failedChecks: [expect.objectContaining({ name: 'desktop:build', category: 'build' })],
    });
  });

  it('returns a zeroed summary when no repository has PR checks', () => {
    const report = buildCiHealth({ repoGraphs: [], days: 7, now: NOW, scannedRepos: 0 });
    expect(report.totals).toMatchObject({
      prCount: 0,
      passed: 0,
      failed: 0,
      pending: 0,
      blocked: 0,
      reposWithPrs: 0,
      passRate: null,
      failureRate: null,
    });
    expect(report.failureCategories).toEqual([]);
  });
});
