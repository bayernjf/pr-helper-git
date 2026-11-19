import { useEffect, useState } from 'react';
import { githubProxy } from '../api';

type BranchesPayload = { name?: string }[];

/**
 * The repository's branch names through the PAT proxy (the same read the old
 * editor's loadBranches did). Null without either a browser PAT or a server
 * PAT, or on a failed read, so the branch picker degrades to a plain
 * free-text input.
 *
 * An empty `pat` is intentional in server-stored mode: the server injects
 * its own admin PAT when the header is absent, so the UI must not short-circuit
 * before making the request.
 */
export function useBranches(
  pat: string,
  hasServerPat: boolean,
  repository: string,
): string[] | null {
  const [branches, setBranches] = useState<string[] | null>(null);
  useEffect(() => {
    if ((!pat && !hasServerPat) || !repository.includes('/')) {
      setBranches(null);
      return;
    }
    let alive = true;
    setBranches(null);
    void (async () => {
      try {
        const result = await githubProxy<BranchesPayload>(pat, `/repos/${repository}/branches?per_page=100`);
        if (!alive) return;
        const names = (result.data ?? []).map((branch) => branch.name ?? '').filter(Boolean);
        setBranches(names.length ? names : null);
      } catch {
        if (alive) setBranches(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [pat, hasServerPat, repository]);
  return branches;
}