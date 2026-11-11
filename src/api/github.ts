import { request } from './core';

// ---------- GitHub proxy ----------

export const mergePull = (
  repo: string,
  number: number,
  mergeMethod: 'merge' | 'squash' | 'rebase',
  pat: string,
) =>
  request('/api/merge-pull', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-pat': pat,
    },
    body: JSON.stringify({ repo, number, mergeMethod }),
  }) as Promise<{ merged: boolean; changed: boolean; state: string }>;

export const markReadyForReview = (repo: string, number: number, pat: string) =>
  request('/api/ready-for-review', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-pat': pat,
    },
    body: JSON.stringify({ repo, number }),
  }) as Promise<{
    ready: boolean;
    changed: boolean;
    isDraft?: boolean;
  }>;

export function githubProxy<T>(
  pat: string,
  path: string,
  method = 'GET',
  payload?: unknown,
): Promise<{ status: number; data: T }> {
  return request('/api/github', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-github-pat': pat },
    body: JSON.stringify({ path, method, payload }),
  });
}
