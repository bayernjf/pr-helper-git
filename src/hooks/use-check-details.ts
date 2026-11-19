import { useEffect, useState } from 'react';
import { githubProxy } from '../api';
import { summarizeGitHubCheckDetails, type GitHubCheckDetail } from '../lib/domain';

type CheckRunsPayload = { check_runs?: Parameters<typeof summarizeGitHubCheckDetails>[0] };
type CommitStatusPayload = { statuses?: Parameters<typeof summarizeGitHubCheckDetails>[1] };

/**
 * Live per-check breakdown for one head sha through the PAT proxy (the same
 * read PrDetailModal does). Null until a read succeeds with entries, so the
 * gate chip degrades to its plain summary exactly like the old gateDisclosure
 * without details. Fail-soft: a missing auth or a failed read keeps the chip.
 *
 * An empty `pat` is intentional in server-stored mode: the server injects its
 * own admin PAT when the header is absent, so the UI must not short-circuit
 * before making the request.
 */
export function useCheckDetails(
  pat: string,
  hasServerPat: boolean,
  repository: string,
  headSha: string | null | undefined,
): GitHubCheckDetail[] | null {
  const [details, setDetails] = useState<GitHubCheckDetail[] | null>(null);
  useEffect(() => {
    if ((!pat && !hasServerPat) || !headSha || !repository.includes('/')) {
      setDetails(null);
      return;
    }
    let alive = true;
    setDetails(null);
    void (async () => {
      try {
        const base = `/repos/${repository}`;
        const [runs, statuses] = await Promise.all([
          githubProxy<CheckRunsPayload>(pat, `${base}/commits/${headSha}/check-runs?per_page=100`),
          githubProxy<CommitStatusPayload>(pat, `${base}/commits/${headSha}/status`),
        ]);
        if (!alive) return;
        const list = summarizeGitHubCheckDetails(runs.data?.check_runs ?? [], statuses.data?.statuses ?? []);
        setDetails(list.length ? list : null);
      } catch {
        if (alive) setDetails(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [pat, hasServerPat, repository, headSha]);
  return details;
}