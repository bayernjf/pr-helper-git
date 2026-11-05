import { describe, expect, it } from 'vitest';
import { parseLog, parsePorcelainV2, parseRefs } from './git.mjs';

describe('parsePorcelainV2', () => {
  it('parses branch, upstream and ahead/behind', () => {
    const out = [
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 abc def src/app.ts',
      '? new.txt',
    ].join('\n');
    const s = parsePorcelainV2(out);
    expect(s.branch).toBe('main');
    expect(s.upstream).toBe('origin/main');
    expect(s.ahead).toBe(2);
    expect(s.behind).toBe(1);
    expect(s.files[0].area).toBe('unstaged');
    expect(s.files[1].area).toBe('untracked');
  });
});

describe('parseRefs', () => {
  it('parses tab-separated ref rows', () => {
    const out = ['abc\tcommit\trefs/heads/main\t\tmain'].join('\n');
    const refs = parseRefs(out);
    expect(refs[0]).toMatchObject({
      hash: 'abc',
      type: 'commit',
      name: 'refs/heads/main',
      shortName: 'main',
      upstream: null,
    });
  });
});

describe('parseLog', () => {
  it('parses record-separated commits with parents', () => {
    const out = `abc\x1fdef ghi\x1ftester\x1fe@x\x1f2026-11-01T00:00:00Z\x1fsubject\x1fbody\x1e`;
    const commits = parseLog(out);
    expect(commits[0].hash).toBe('abc');
    expect(commits[0].parents).toEqual(['def', 'ghi']);
    expect(commits[0].body).toBe('body');
  });

  it('returns an empty list for blank input', () => {
    expect(parseLog('')).toEqual([]);
  });
});
