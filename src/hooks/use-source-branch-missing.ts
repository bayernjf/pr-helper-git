import { useEffect, useState } from 'react';
import { ApiError } from '../api/core';
import { githubProxy } from '../api';

/**
 * The upstream detail page warns when the stage's source branch no longer
 * exists on GitHub (typically after a merged PR branch was deleted). This is
 * a live branch read; no projection column is involved, and wildcard routes
 * are skipped because their `feature/*` pattern is not a branch name.
 */
export function useSourceBranchMissing(
  pat: string,
  hasServerPat: boolean,
  repository: string,
  source: string,
): boolean {
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    setMissing(false);
    if ((!pat && !hasServerPat) || !repository.includes('/') || !source || source.includes('*')) return;
    let alive = true;
    void (async () => {
      try {
        await githubProxy(pat, `/repos/${repository}/branches/${encodeURIComponent(source)}`);
      } catch (err) {
        if (alive && err instanceof ApiError && err.status === 404) setMissing(true);
      }
    })();
    return () => { alive = false; };
  }, [pat, hasServerPat, repository, source]);
  return missing;
}
