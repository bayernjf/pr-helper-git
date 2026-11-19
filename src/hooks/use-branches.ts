import { useEffect, useState } from 'react';
import { githubProxy } from '../api';

type BranchesPayload = { name?: string }[];

/**
 * The repository's branch names through the PAT proxy (the same read the old
 * editor's loadBranches did). Null without a PAT or on a failed read, so the
 * branch picker degrades to a plain free-text input.
 */
export function useBranches(pat: string, repository: string): string[] | null {
  const [branches, setBranches] = useState<string[] | null>(null);
  useEffect(() => {
    if (!pat || !repository.includes('/')) {
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
  }, [pat, repository]);
  return branches;
}