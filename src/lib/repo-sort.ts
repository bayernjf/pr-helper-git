// Pure helpers behind the multi-repository panel: freshness buckets, pin-aware
// ordering and the header aggregate. Kept out of the component so the rules can
// be unit-tested without a DOM.

import { getLocale } from '../i18n';

export type ActivityLevel = 'fresh' | 'recent' | 'stale' | 'dormant' | 'none';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Freshness of the last commit: under an hour is "fresh", under a day "recent",
 * under a week "stale", anything older "dormant". A missing or unparsable
 * timestamp is "none" rather than "dormant", so a repository that never had a
 * commit does not look neglected.
 */
export function activityLevel(at: string | null | undefined, now: number = Date.now()): ActivityLevel {
  if (!at) return 'none';
  const ms = new Date(at).getTime();
  if (!Number.isFinite(ms)) return 'none';
  const age = now - ms;
  if (age < 0) return 'fresh';
  if (age <= HOUR) return 'fresh';
  if (age <= DAY) return 'recent';
  if (age <= 7 * DAY) return 'stale';
  return 'dormant';
}

export function relativeAge(at: string | null | undefined, now: number = Date.now()): string {
  if (!at) return '';
  const ms = new Date(at).getTime();
  if (!Number.isFinite(ms)) return '';
  const age = Math.max(0, now - ms);
  if (getLocale() === 'zh') {
    if (age < MINUTE) return '刚刚';
    if (age < HOUR) return `${Math.floor(age / MINUTE)} 分钟前`;
    if (age < DAY) return `${Math.floor(age / HOUR)} 小时前`;
    if (age < 30 * DAY) return `${Math.floor(age / DAY)} 天前`;
    if (age < 365 * DAY) return `${Math.floor(age / (30 * DAY))} 个月前`;
    return `${Math.floor(age / (365 * DAY))} 年前`;
  }
  if (age < MINUTE) return 'just now';
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m ago`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h ago`;
  if (age < 30 * DAY) return `${Math.floor(age / DAY)}d ago`;
  if (age < 365 * DAY) return `${Math.floor(age / (30 * DAY))}mo ago`;
  return `${Math.floor(age / (365 * DAY))}y ago`;
}

type Sortable = { path: string; name: string; staged: number; unstaged: number; untracked: number };

/**
 * Pinned repositories first, then the ones with work in progress, then by name.
 * Ordering is stable within each group; the caller's array is not mutated.
 */
export function sortRepos<T extends Sortable>(repos: T[], pinned: string[]): T[] {
  const pinnedSet = new Set(pinned);
  const rank = (r: T) => {
    if (pinnedSet.has(r.path)) return 0;
    if (r.staged + r.unstaged + r.untracked > 0) return 1;
    return 2;
  };
  return [...repos].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    return a.name.localeCompare(b.name);
  });
}

export type RepoAggregate = {
  repos: number;
  dirtyRepos: number;
  changedFiles: number;
  ahead: number;
  behind: number;
  unavailable: number;
};

export function summarizeRepos(
  repos: { staged: number; unstaged: number; untracked: number; ahead: number; behind: number; error?: string | null }[],
): RepoAggregate {
  const out: RepoAggregate = { repos: repos.length, dirtyRepos: 0, changedFiles: 0, ahead: 0, behind: 0, unavailable: 0 };
  for (const r of repos) {
    const changed = r.staged + r.unstaged + r.untracked;
    if (changed > 0) out.dirtyRepos += 1;
    out.changedFiles += changed;
    out.ahead += Math.max(0, r.ahead || 0);
    out.behind += Math.max(0, r.behind || 0);
    if (r.error) out.unavailable += 1;
  }
  return out;
}
