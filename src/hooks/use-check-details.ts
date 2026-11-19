import { useEffect, useState } from 'react';
import { githubProxy } from '../api';
import { summarizeGitHubCheckDetails, type GitHubCheckDetail } from '../lib/domain';

type CheckRunsPayload = { check_runs?: Parameters<typeof summarizeGitHubCheckDetails>[0] };
type CommitStatusPayload = { statuses?: Parameters<typeof summarizeGitHubCheckDetails>[1] };

/**
 * Live per-check breakdown for one head sha through the PAT proxy (the same
 * read PrDetailModal does). Null until a read succeeds with entries, so the
 * gate chip degrades to its plain summary exactly like the old gateDisclosure
 * without details. Fail-soft: a missing PAT or a failed read keeps the chip.
 */
export function useCheckDetails(
  pat: string,
  repository: string,
  headSha: string | null | undefined,
): GitHubCheckDetail[] | null {
  const [details, setDetails] = useState<GitHubCheckDetail[] | null>(null);
  useEffect(() => {
    if (!pat || !headSha || !repository.includes('/')) {
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
  }, [pat, repository, headSha]);
  return details;
}