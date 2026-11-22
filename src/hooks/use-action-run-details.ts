import { useEffect, useState } from 'react';
import { githubProxy } from '../api';
import { summarizeGitHubCheckDetails, type GitHubCheckDetail } from '../lib/domain';

type WorkflowRunsPayload = {
  workflow_runs?: Array<{
    name?: string | null;
    display_title?: string | null;
    status?: string;
    conclusion?: string | null;
    html_url?: string | null;
  }>;
};

/**
 * Live Actions-run breakdown for one head sha. The upstream step page showed a
 * second gate disclosure next to checks, sourced from /actions/runs rather than
 * check-runs; this hook keeps that distinction without persisting a new column.
 */
export function useActionRunDetails(
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
        const payload = await githubProxy<WorkflowRunsPayload>(
          pat,
          `/repos/${repository}/actions/runs?head_sha=${encodeURIComponent(headSha)}&per_page=30`,
        );
        if (!alive) return;
        const runs = (payload.data?.workflow_runs ?? []).map((run) => ({
          name: run.display_title || run.name || 'Workflow run',
          app: { slug: 'github-actions' },
          status: run.status === 'completed' ? 'completed' : 'in_progress',
          conclusion: run.conclusion ?? null,
          html_url: run.html_url ?? null,
        }));
        const list = summarizeGitHubCheckDetails(runs, []);
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
