import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCommitSearch } from './search-commits.mjs';
import { parseLog } from './git.mjs';

const sh = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' });

describe('buildCommitSearch', () => {
  it('greps the message by default', () => {
    const out = buildCommitSearch('fix login');
    expect(out).toMatchObject({ mode: 'message', term: 'fix login' });
    expect(out.args).toContain('--all');
    expect(out.args).toContain('--grep=fix login');
    expect(out.args).not.toContain('--');
  });

  it('routes author: to --author', () => {
    const out = buildCommitSearch('author:  Ada  ');
    expect(out).toMatchObject({ mode: 'author', term: 'Ada' });
    expect(out.args).toContain('--author=Ada');
    expect(out.args.some((a) => a.startsWith('--grep'))).toBe(false);
  });

  it('routes path: to a pathspec', () => {
    const out = buildCommitSearch('path:src/app.ts');
    expect(out).toMatchObject({ mode: 'path', term: 'src/app.ts' });
    expect(out.args[out.args.length - 2]).toBe('--');
    expect(out.args[out.args.length - 1]).toBe('src/app.ts');
  });

  it('rejects empty, overlong and multi-line queries', () => {
    expect(buildCommitSearch('   ')).toEqual({ error: 'missing query' });
    expect(buildCommitSearch('author:  ')).toEqual({ error: 'missing term after "author:"' });
    expect(buildCommitSearch('x'.repeat(201)).error).toBe('query is too long');
    expect(buildCommitSearch('a\nb').error).toBe('invalid query');
  });

  it('caps the result limit', () => {
    expect(buildCommitSearch('x', { limit: 500 }).args).toContain('--max-count=100');
    expect(buildCommitSearch('x', { limit: 0 }).args).toContain('--max-count=30');
  });
});

describe('commit search against a real repository', () => {
  it('finds commits on other branches, by author and by path', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'prh-search-'));
    try {
      sh(repo, ['init', '-q']);
      sh(repo, ['config', 'user.email', 'dev@example.com']);
      sh(repo, ['config', 'user.name', 'Dev']);
      fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
      sh(repo, ['add', '.']);
      sh(repo, ['commit', '-qm', 'base commit']);
      // The default branch name depends on the machine's git config.
      const baseBranch = sh(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();

      // A commit only reachable from a side branch: --all must still find it.
      sh(repo, ['checkout', '-qb', 'feature']);
      fs.writeFileSync(path.join(repo, 'b.txt'), 'two\n');
      sh(repo, ['add', '.']);
      sh(repo, ['-c', 'user.name=Ada Lovelace', 'commit', '-qm', 'Add NEEDLE handling']);
      sh(repo, ['checkout', '-q', baseBranch]);

      const byMessage = parseLog(sh(repo, buildCommitSearch('needle').args));
      expect(byMessage.map((c) => c.subject)).toContain('Add NEEDLE handling');

      const byAuthor = parseLog(sh(repo, buildCommitSearch('author:lovelace').args));
      expect(byAuthor).toHaveLength(1);
      expect(byAuthor[0].subject).toBe('Add NEEDLE handling');

      const byPath = parseLog(sh(repo, buildCommitSearch('path:b.txt').args));
      expect(byPath.map((c) => c.subject)).toEqual(['Add NEEDLE handling']);

      const noMatch = parseLog(sh(repo, buildCommitSearch('nothing-matches').args));
      expect(noMatch).toEqual([]);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
