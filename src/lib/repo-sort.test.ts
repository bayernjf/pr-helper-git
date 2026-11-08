import { describe, expect, it } from 'vitest';
import { activityLevel, relativeAge, sortRepos, summarizeRepos } from './repo-sort';

const NOW = new Date('2026-11-08T12:00:00Z').getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('activityLevel', () => {
  it('buckets by the age of the last commit', () => {
    expect(activityLevel(ago(10 * 60 * 1000), NOW)).toBe('fresh');
    expect(activityLevel(ago(5 * HOUR), NOW)).toBe('recent');
    expect(activityLevel(ago(3 * DAY), NOW)).toBe('stale');
    expect(activityLevel(ago(30 * DAY), NOW)).toBe('dormant');
  });

  it('treats a missing or broken timestamp as none', () => {
    expect(activityLevel(null, NOW)).toBe('none');
    expect(activityLevel(undefined, NOW)).toBe('none');
    expect(activityLevel('not-a-date', NOW)).toBe('none');
  });

  it('clamps future timestamps to fresh', () => {
    expect(activityLevel(ago(-2 * HOUR), NOW)).toBe('fresh');
  });
});

describe('relativeAge', () => {
  it('formats minutes, hours, days, months', () => {
    expect(relativeAge(ago(30 * 1000), NOW)).toBe('just now');
    expect(relativeAge(ago(10 * 60 * 1000), NOW)).toBe('10m ago');
    expect(relativeAge(ago(3 * HOUR), NOW)).toBe('3h ago');
    expect(relativeAge(ago(5 * DAY), NOW)).toBe('5d ago');
    expect(relativeAge(ago(90 * DAY), NOW)).toBe('3mo ago');
  });

  it('returns empty for a missing timestamp', () => {
    expect(relativeAge(null, NOW)).toBe('');
  });
});

describe('sortRepos', () => {
  const repo = (name: string, dirty = 0) => ({
    path: `/repos/${name}`,
    name,
    staged: dirty,
    unstaged: 0,
    untracked: 0,
  });

  it('puts pinned first, then dirty, then clean by name', () => {
    const repos = [repo('alpha'), repo('zulu', 1), repo('beta'), repo('pinned-clean')];
    const sorted = sortRepos(repos, ['/repos/pinned-clean']);
    expect(sorted.map((r) => r.name)).toEqual(['pinned-clean', 'zulu', 'alpha', 'beta']);
  });

  it('does not mutate the input', () => {
    const repos = [repo('b'), repo('a')];
    const copy = [...repos];
    sortRepos(repos, []);
    expect(repos).toEqual(copy);
  });
});

describe('summarizeRepos', () => {
  it('aggregates change counts, sync counts and failures', () => {
    const agg = summarizeRepos([
      { staged: 2, unstaged: 1, untracked: 3, ahead: 2, behind: 1 },
      { staged: 0, unstaged: 0, untracked: 0, ahead: 0, behind: 4 },
      { staged: 0, unstaged: 0, untracked: 0, ahead: 0, behind: 0, error: 'gone' },
    ]);
    expect(agg).toEqual({ repos: 3, dirtyRepos: 1, changedFiles: 6, ahead: 2, behind: 5, unavailable: 1 });
  });

  it('is all zeroes for an empty list', () => {
    expect(summarizeRepos([])).toEqual({ repos: 0, dirtyRepos: 0, changedFiles: 0, ahead: 0, behind: 0, unavailable: 0 });
  });
});
