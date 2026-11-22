import { useEffect, useState } from 'react';
import { githubProxy } from '../api';

type PullPayload = { head?: { sha?: string | null } };

/**
 * Projection rows do not persist the pull head sha. The drawer still needs it
 * for the live checks and Actions disclosures, so resolve it from the pull
 * itself when the row lacks one.
 */
export function usePullHeadSha(
  pat: string,
  hasServerPat: boolean,
  repository: string,
  pullNumber: number | null | undefined,
  current: string | null | undefined,
): string | null {
  const [sha, setSha] = useState<string | null>(null);
  useEffect(() => {
    setSha(null);
    if (current || !pullNumber || (!pat && !hasServerPat) || !repository.includes('/')) return;
    let alive = true;
    void (async () => {
      try {
        const payload = await githubProxy<PullPayload>(pat, `/repos/${repository}/pulls/${pullNumber}`);
        if (alive) setSha(payload.data?.head?.sha ?? null);
      } catch {
        if (alive) setSha(null);
      }
    })();
    return () => { alive = false; };
  }, [pat, hasServerPat, repository, pullNumber, current]);
  return current ?? sha;
}
