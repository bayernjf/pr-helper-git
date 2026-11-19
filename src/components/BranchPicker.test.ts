// Branch combobox filter semantics (the old editor's filterSourceBranches):
// trimmed, case-insensitive substring match over the repository's branches.
import { describe, expect, it } from 'vitest';
import { filterBranches } from './BranchPicker';

const BRANCHES = ['main', 'dev', 'feature/login', 'feature/pay', 'fix/crash', 'release/1.2'];

describe('filterBranches', () => {
  it('returns every branch for an empty or whitespace query, without aliasing the input', () => {
    expect(filterBranches(BRANCHES, '')).toEqual(BRANCHES);
    expect(filterBranches(BRANCHES, '   ')).toEqual(BRANCHES);
    expect(filterBranches(BRANCHES, '')).not.toBe(BRANCHES);
  });

  it('matches case-insensitive substrings anywhere in the name', () => {
    expect(filterBranches(BRANCHES, 'FEATURE')).toEqual(['feature/login', 'feature/pay']);
    expect(filterBranches(BRANCHES, ' login ')).toEqual(['feature/login']);
    expect(filterBranches(BRANCHES, '1.2')).toEqual(['release/1.2']);
  });

  it('returns nothing when no branch matches (a typed wildcard rule is not a branch)', () => {
    expect(filterBranches(BRANCHES, 'feature/*')).toEqual([]);
    expect(filterBranches([], 'dev')).toEqual([]);
  });
});