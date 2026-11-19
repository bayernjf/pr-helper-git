import type { PullRequest } from '../types';

export interface PullMergeability {
  number: number;
  mergeable: boolean | null;
  mergeable_state: string | null;
}

/**
 * The PR list endpoint never returns computed mergeability. Apply the
 * repository-wide GraphQL lookup to open cards only; closed/merged cards do
 * not render the merge pill. Missing rows keep the original value, and a
 * null GraphQL result stays "unknown" so the UI can continue to show
 * "computing" instead of incorrectly claiming a conflict.
 */
export function applyPullMergeability(
  pulls: PullRequest[],
  rows: PullMergeability[],
): PullRequest[] {
  if (rows.length === 0) return pulls;
  const byNumber = new Map(rows.map((row) => [row.number, row]));
  return pulls.map((pull) => {
    if (pull.state !== 'open') return pull;
    const row = byNumber.get(pull.number);
    if (!row) return pull;
    return {
      ...pull,
      mergeable: row.mergeable,
      mergeable_state: row.mergeable_state || 'unknown',
    };
  });
}
