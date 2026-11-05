import type { ReviewState } from '../types';

export interface GithubReview {
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
  user: { login: string } | null;
  submitted_at?: string | null;
}

// Collapse the review list into one summary state. Each user's latest review
// wins; requested changes outrank approvals, which outrank comments.
export function summarizeReviews(reviews: GithubReview[]): ReviewState {
  const byUser = new Map<string, GithubReview['state']>();
  for (const review of reviews) {
    const login = review.user?.login;
    if (!login) continue;
    byUser.set(login, review.state); // later entries are newer
  }

  const states = [...byUser.values()];
  if (states.includes('CHANGES_REQUESTED')) return 'CHANGES_REQUESTED';
  if (states.includes('APPROVED')) return 'APPROVED';
  if (states.includes('COMMENTED')) return 'COMMENTED';
  return 'NONE';
}
