import { describe, expect, it } from 'vitest';
import { summarizeReviews, type GithubReview } from './review';

function review(login: string, state: GithubReview['state']): GithubReview {
  return { state, user: { login } };
}

describe('summarizeReviews', () => {
  it('returns NONE for an empty list', () => {
    expect(summarizeReviews([])).toBe('NONE');
  });

  it('reports a single approval', () => {
    expect(summarizeReviews([review('alice', 'APPROVED')])).toBe('APPROVED');
  });

  it('lets requested changes outrank an approval', () => {
    const reviews = [
      review('alice', 'APPROVED'),
      review('bob', 'CHANGES_REQUESTED'),
    ];
    expect(summarizeReviews(reviews)).toBe('CHANGES_REQUESTED');
  });

  it('uses the latest review from the same user', () => {
    const reviews = [
      review('alice', 'CHANGES_REQUESTED'),
      review('alice', 'APPROVED'),
    ];
    expect(summarizeReviews(reviews)).toBe('APPROVED');
  });

  it('falls back to commented when no decision is present', () => {
    expect(summarizeReviews([review('alice', 'COMMENTED')])).toBe('COMMENTED');
  });

  it('ignores reviews without a user and non-decision states', () => {
    const reviews = [
      { state: 'PENDING', user: null } as GithubReview,
      review('alice', 'DISMISSED'),
    ];
    expect(summarizeReviews(reviews)).toBe('NONE');
  });
});
