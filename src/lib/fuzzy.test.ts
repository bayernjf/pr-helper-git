import { describe, expect, it } from 'vitest';
import { matchesCommand } from './fuzzy';

describe('matchesCommand', () => {
  it('matches everything for an empty query', () => {
    expect(matchesCommand('Switch to Git view', '')).toBe(true);
    expect(matchesCommand('anything', '   ')).toBe(true);
  });

  it('matches a single term case-insensitively', () => {
    expect(matchesCommand('Switch to Git view', 'git')).toBe(true);
    expect(matchesCommand('Switch to Git view', 'GIT')).toBe(true);
  });

  it('requires every term to appear (AND across words)', () => {
    expect(matchesCommand('pull requests pr board github', 'pr github')).toBe(true);
    expect(matchesCommand('pull requests pr board', 'pr gitlab')).toBe(false);
  });

  it('rejects when any term is absent', () => {
    expect(matchesCommand('Fetch all remotes', 'fetch push')).toBe(false);
  });
});
