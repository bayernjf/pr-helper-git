import { describe, expect, it } from 'vitest';
import type { PullRequest } from '../types';
import { applyPullMergeability, type PullMergeability } from './pull-mergeability';

function pull(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 7,
    title: 'Test PR',
    body: '',
    state: 'open',
    draft: false,
    user: { login: 'alice', avatar_url: '' },
    head: { ref: 'feature', sha: 'abc', label: 'alice:feature' },
    base: { ref: 'main', sha: 'def', label: 'bayernjf:main' },
    html_url: '',
    created_at: '',
    updated_at: '',
    mergeable: null,
    mergeable_state: 'unknown',
    labels: [],
    reviewState: 'NONE',
    ...overrides,
  };
}

function row(overrides: Partial<PullMergeability> = {}): PullMergeability {
  return { number: 7, mergeable: true, mergeable_state: 'clean', ...overrides };
}

describe('applyPullMergeability', () => {
  it('applies a clean GraphQL result to an open PR', () => {
    const [result] = applyPullMergeability([pull()], [row()]);
    expect(result.mergeable).toBe(true);
    expect(result.mergeable_state).toBe('clean');
  });

  it('keeps unknown when GitHub has not computed mergeability', () => {
    const [result] = applyPullMergeability([pull()], [row({ mergeable: null, mergeable_state: null })]);
    expect(result.mergeable).toBeNull();
    expect(result.mergeable_state).toBe('unknown');
  });

  it('leaves closed PRs and unmatched numbers untouched', () => {
    const closed = pull({ number: 8, state: 'closed', mergeable: false, mergeable_state: 'dirty' });
    const [result] = applyPullMergeability([closed], [row({ number: 7 })]);
    expect(result).toBe(closed);
  });

  it('returns the original array when there is no lookup result', () => {
    const pulls = [pull()];
    expect(applyPullMergeability(pulls, [])).toBe(pulls);
  });
});
