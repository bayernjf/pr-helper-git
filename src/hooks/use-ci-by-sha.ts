import { useEffect, useState } from 'react';
import { githubProxy } from '../api';
import { aggregateCi } from '../lib/ci';

interface GithubRemote {
  isGithub?: boolean;
  owner?: string | null;
  repo?: string | null;
}

/**
 * Map commit SHA to a rolled-up CI state for the open PR heads shown in the
 * graph. Same precedence as the rest of the app: failure > pending > success.
 */
export function useCiBySha(
  pat: string | null,
  hasServerPat: boolean,
  remote: GithubRemote | null,
  currentRepo: string | null,
): Record<string, string> {
  const [ciBySha, setCiBySha] = useState<Record<string, string>>({});

  useEffect(() => {
    if ((!pat && !hasServerPat) || !remote?.isGithub || !remote.owner || !remote.repo) {
      setCiBySha({});
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const base = `/repos/${remote.owner}/${remote.repo}`;
        const pulls = await githubProxy<Array<{ number: number; head: { sha: string } }>>(
          pat || '',
          `${base}/pulls?state=open&per_page=100`,
        );
        const heads = (Array.isArray(pulls.data) ? pulls.data : []).slice(0, 10).map((p) => p.head.sha);
        const next: Record<string, string> = {};
        await Promise.allSettled(heads.map(async (sha) => {
          try {
            const runs = await githubProxy<{ check_runs?: Array<{ state?: string; conclusion?: string }> }>(
              pat || '',
              `${base}/commits/${sha}/check-runs`,
            );
            const statuses = await githubProxy<Array<{ state?: string }>>(
              pat || '',
              `${base}/commits/${sha}/statuses`,
            );
            const list = [
              ...((runs.data && runs.data.check_runs) || []).map((c) => ({ state: c.state, conclusion: c.conclusion })),
              ...(Array.isArray(statuses.data) ? statuses.data : []).map((st) => ({ state: st.state })),
            ];
            next[sha] = aggregateCi(list);
          } catch {
            next[sha] = 'none';
          }
        }));
        if (alive) setCiBySha(next);
      } catch {
        if (alive) setCiBySha({});
      }
    })();
    return () => {
      alive = false;
    };
  }, [pat, hasServerPat, remote, currentRepo]);

  return ciBySha;
}
