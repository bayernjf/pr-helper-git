import { describe, expect, it } from 'vitest';
import { isAllowed } from './github-allowlist.mjs';

describe('github allowlist', () => {
  it('allows the CI endpoints the PR panel reads', () => {
    expect(isAllowed('GET', '/repos/o/r/commits/abc123/check-runs')).toBe(true);
    expect(isAllowed('GET', '/repos/o/r/commits/abc123/status')).toBe(true);
    expect(isAllowed('GET', '/repos/o/r/branches/main/protection')).toBe(true);
  });

  it('allows label reads and label mutations on a pull request', () => {
    expect(isAllowed('GET', '/repos/o/r/labels')).toBe(true);
    expect(isAllowed('GET', '/repos/o/r/issues/12/labels')).toBe(true);
    expect(isAllowed('POST', '/repos/o/r/issues/12/labels')).toBe(true);
    expect(isAllowed('DELETE', '/repos/o/r/issues/12/labels/needs%20review')).toBe(true);
    expect(isAllowed('POST', '/repos/o/r/labels')).toBe(false);
  });

  it('rejects sibling and mutating endpoints', () => {
    expect(isAllowed('DELETE', '/repos/o/r/branches/main/protection')).toBe(false);
    expect(isAllowed('PUT', '/repos/o/r/branches/main/protection')).toBe(false);
    expect(isAllowed('GET', '/repos/o/r/actions/runs')).toBe(false);
    expect(isAllowed('GET', '/repos/o/r/branches/main/protection/required_status_checks')).toBe(false);
  });

  it('rejects traversal and non-absolute paths', () => {
    expect(isAllowed('GET', '/repos/o/r/../secrets')).toBe(false);
    expect(isAllowed('GET', 'repos/o/r')).toBe(false);
  });
});
