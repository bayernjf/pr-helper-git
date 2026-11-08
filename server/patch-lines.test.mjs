import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { splitFilePatch } from './git.mjs';
import { buildLineSelectionPatch, parseHunk } from './patch-lines.mjs';

const HEADER = [
  'diff --git a/notes.txt b/notes.txt',
  '--- a/notes.txt',
  '+++ b/notes.txt',
];

function sh(cwd, args, input) {
  return execFileSync('git', args, { cwd, input, encoding: 'utf8' });
}

describe('parseHunk', () => {
  it('numbers context, added and removed lines on both sides', () => {
    const parsed = parseHunk(['@@ -5,3 +5,4 @@ fn x() {', ' a', '-b', '+c', ' d', '']);
    expect(parsed).toMatchObject({ startOld: 5, countOld: 3, startNew: 5, countNew: 4 });
    expect(parsed.lines).toEqual([
      { kind: 'ctx', index: 0, oldLn: 5, newLn: 5, text: 'a' },
      { kind: 'del', index: 1, oldLn: 6, newLn: null, text: 'b' },
      { kind: 'add', index: 2, oldLn: null, newLn: 6, text: 'c' },
      { kind: 'ctx', index: 3, oldLn: 7, newLn: 7, text: 'd' },
    ]);
  });

  it('rejects a hunk without a parsable header', () => {
    expect(parseHunk(['not a header', ' x'])).toBeNull();
  });

  it('keeps body indexing over the no-newline marker', () => {
    const parsed = parseHunk(['@@ -1 +1 @@', '-a', '\\ No newline at end of file', '+b', '\\ No newline at end of file']);
    expect(parsed.lines.map((l) => l.index)).toEqual([0, 1, 2, 3]);
  });
});

describe('buildLineSelectionPatch', () => {
  const HUNK = ['@@ -1,4 +1,6 @@', ' l1', ' l2', '+NEW-A', ' l3', '+NEW-B', ' l4'];

  it('keeps all context lines and only the selected additions', () => {
    const patch = buildLineSelectionPatch(HEADER, HUNK, [2]);
    expect(patch).toBe([
      ...HEADER,
      '@@ -1,4 +1,5 @@',
      ' l1',
      ' l2',
      '+NEW-A',
      ' l3',
      ' l4',
      '',
    ].join('\n'));
  });

  it('returns null when only context lines are selected', () => {
    expect(buildLineSelectionPatch(HEADER, HUNK, [0, 1])).toBeNull();
  });

  it('preserves a zero-count start instead of shrinking it', () => {
    const patch = buildLineSelectionPatch(HEADER, ['@@ -2,0 +3,2 @@', '+X', '+Y'], [1]);
    // The old side keeps "after line 2" semantics; X is dropped because the
    // index never had it.
    expect(patch).toContain('@@ -2,0 +');
    expect(patch).toContain('+Y');
    expect(patch).not.toContain('+X');
  });

  it('keeps an unselected removal as context so the pre-image still matches', () => {
    const patch = buildLineSelectionPatch(
      HEADER,
      ['@@ -1 +1,2 @@', '-a', '\\ No newline at end of file', '+b', '\\ No newline at end of file'],
      [2],
    );
    // The removed line still exists in the index, so it must stay as context;
    // only the marker of the unselected change is dropped.
    expect(patch).toContain('@@ -1,1 +1,2 @@');
    expect(patch).toContain(' a\n+b');
    expect(patch.match(/No newline/g)).toHaveLength(1);
  });

  it('turns an unselected addition into context when unstaging', () => {
    const patch = buildLineSelectionPatch(
      HEADER,
      ['@@ -1,2 +1,4 @@', ' l1', '+KEEP', '+DROP', ' l2'],
      [2],
      'unstage',
    );
    // Selected +DROP is reverse-applied; +KEEP must stay as context (it is
    // already in the index) or the post-image would not match.
    expect(patch).toContain('@@ -1,3 +1,4 @@');
    expect(patch).toContain(' KEEP');
    expect(patch).not.toContain('+KEEP');
    expect(patch).toContain('+DROP');
  });
});

describe('line selection against a real repository', () => {
  it('stages only the selected addition', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'prh-lines-'));
    try {
      fs.writeFileSync(path.join(repo, 'notes.txt'), 'l1\nl2\nl3\nl4\n');
      sh(repo, ['init', '-q']);
      sh(repo, ['config', 'user.email', 't@example.com']);
      sh(repo, ['config', 'user.name', 'T']);
      sh(repo, ['add', '.']);
      sh(repo, ['commit', '-qm', 'base']);

      fs.writeFileSync(path.join(repo, 'notes.txt'), 'l1\nl2\nNEW-A\nl3\nNEW-B\nl4\n');
      const { header, hunks } = splitFilePatch(sh(repo, ['diff', '--', 'notes.txt']));
      expect(hunks).toHaveLength(1);

      const parsed = parseHunk(hunks[0]);
      const addA = parsed.lines.find((l) => l.text === 'NEW-A');
      const addB = parsed.lines.find((l) => l.text === 'NEW-B');
      expect(addA?.kind).toBe('add');
      expect(addB?.kind).toBe('add');

      const patch = buildLineSelectionPatch(header, hunks[0], [addA.index]);
      sh(repo, ['apply', '--cached', '-'], patch);

      const staged = sh(repo, ['diff', '--cached', '--', 'notes.txt']);
      expect(staged).toContain('+NEW-A');
      expect(staged).not.toContain('+NEW-B');

      const unstaged = sh(repo, ['diff', '--', 'notes.txt']);
      expect(unstaged).toContain('+NEW-B');
      expect(unstaged).not.toContain('+NEW-A');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('unstages only the selected line from the index', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'prh-lines-'));
    try {
      fs.writeFileSync(path.join(repo, 'notes.txt'), 'l1\nl2\nl3\n');
      sh(repo, ['init', '-q']);
      sh(repo, ['config', 'user.email', 't@example.com']);
      sh(repo, ['config', 'user.name', 'T']);
      sh(repo, ['add', '.']);
      sh(repo, ['commit', '-qm', 'base']);

      fs.writeFileSync(path.join(repo, 'notes.txt'), 'l1\nl2\nADDED-1\nADDED-2\nl3\n');
      sh(repo, ['add', '--', 'notes.txt']);

      const { header, hunks } = splitFilePatch(sh(repo, ['diff', '--cached', '--', 'notes.txt']));
      const parsed = parseHunk(hunks[0]);
      const first = parsed.lines.find((l) => l.text === 'ADDED-1');
      const patch = buildLineSelectionPatch(header, hunks[0], [first.index], 'unstage');
      sh(repo, ['apply', '--cached', '-R', '-'], patch);

      const staged = sh(repo, ['diff', '--cached', '--', 'notes.txt']);
      expect(staged).not.toContain('+ADDED-1');
      expect(staged).toContain('+ADDED-2');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
