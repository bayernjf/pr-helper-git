import { describe, expect, it } from 'vitest';
import {
  parseBlame,
  parseLog,
  parsePorcelainV2,
  parseRefs,
  parseReflog,
  parseTagObject,
} from './git.mjs';

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

describe('parseBlame', () => {
  const A = 'aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111';
  const B = 'bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222';

  it('parses one record per final line and reuses repeated commit metadata', () => {
    const out = [
      `${A} 1 1 1`,
      'author Alice',
      'author-mail <alice@example.com>',
      'author-time 1700000000',
      'author-tz +0800',
      'committer Alice',
      'committer-mail <alice@example.com>',
      'committer-time 1700000000',
      'committer-tz +0800',
      'summary first commit',
      'filename src/app.ts',
      '\tline one',
      `${B} 2 2 1`,
      'author Bob',
      'author-mail <bob@example.com>',
      'author-time 1700000500',
      'author-tz +0800',
      'committer Bob',
      'committer-mail <bob@example.com>',
      'committer-time 1700000500',
      'committer-tz +0800',
      'summary second commit',
      'filename src/app.ts',
      '\tline two',
      `${B} 3 3`,
      '\tline three',
    ].join('\n');

    const lines = parseBlame(out);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({
      line: 1,
      sha: A,
      author: 'Alice',
      email: 'alice@example.com',
      time: 1700000000,
      summary: 'first commit',
      text: 'line one',
    });
    expect(lines[1].author).toBe('Bob');
    expect(lines[1].email).toBe('bob@example.com');
    expect(lines[1].text).toBe('line two');
    // A later block for the same commit carries no metadata but still resolves it.
    expect(lines[2]).toMatchObject({
      line: 3,
      sha: B,
      author: 'Bob',
      summary: 'second commit',
      text: 'line three',
    });
  });

  it('returns an empty list for blank input', () => {
    expect(parseBlame('')).toEqual([]);
  });
});

describe('parseReflog', () => {
  it('parses action and description from reflog lines', () => {
    const out = [
      '343f1a9 HEAD@{0}: reset: moving to HEAD',
      '1c8ce46 HEAD@{2}: revert: Revert "chore: bulk commit 200"',
      'abcdef1 HEAD@{3}: checkout: moving from main to feature/x',
    ].join('\n');
    const entries = parseReflog(out);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      hash: '343f1a9',
      ref: 'HEAD',
      index: 0,
      action: 'reset',
      description: 'moving to HEAD',
    });
    expect(entries[1].action).toBe('revert');
    expect(entries[1].description).toBe('Revert "chore: bulk commit 200"');
    expect(entries[2].description).toBe('moving from main to feature/x');
  });

  it('keeps the whole text as action when no colon is present', () => {
    const entries = parseReflog('abcdef1 main@{0}: some plain event');
    expect(entries[0]).toMatchObject({ action: 'some plain event', description: '' });
  });
});

describe('parseTagObject', () => {
  it('parses tagger, timestamp and message', () => {
    const out = [
      'object 343f1a9f4fb3468c904a287b98477ddfa3f7d287',
      'type commit',
      'tag v0.1.0',
      'tagger Alice <alice@example.com> 1700000000 +0800',
      '',
      'Release 0.1.0',
      '',
      'First annotated release',
    ].join('\n');
    const tag = parseTagObject(out);
    expect(tag.object).toBe('343f1a9f4fb3468c904a287b98477ddfa3f7d287');
    expect(tag.type).toBe('commit');
    expect(tag.tag).toBe('v0.1.0');
    expect(tag.tagger).toBe('Alice');
    expect(tag.taggerEmail).toBe('alice@example.com');
    expect(tag.time).toBe(1700000000);
    expect(tag.subject).toBe('Release 0.1.0');
    expect(tag.body).toBe('First annotated release');
  });
});
