import { describe, expect, it } from 'vitest';
import { pairDiffRows, parseDiffLines, wordDiff, wordSegmentsByRow } from './diff-lines';

const DIFF = [
  'diff --git a/f.js b/f.js',
  'index 111..222 100644',
  '--- a/f.js',
  '+++ b/f.js',
  '@@ -1,3 +1,4 @@',
  ' line one',
  ' line two',
  '-old line',
  '+new line',
  '+added line',
  ' line three',
].join('\n');

describe('parseDiffLines', () => {
  it('classifies header and metadata rows', () => {
    const rows = parseDiffLines(DIFF);
    expect(rows[0].kind).toBe('meta');
    expect(rows.filter((r) => r.kind === 'hunk')).toHaveLength(1);
  });

  it('derives old and new line numbers from the hunk header', () => {
    const rows = parseDiffLines(DIFF);
    const ctx = rows.filter((r) => r.kind === 'ctx');
    expect(ctx[0].oldNo).toBe(1);
    expect(ctx[0].newNo).toBe(1);
    expect(ctx[1].oldNo).toBe(2);
    expect(ctx[1].newNo).toBe(2);
  });

  it('tracks deletion and addition line numbers independently', () => {
    const rows = parseDiffLines(DIFF);
    const del = rows.find((r) => r.kind === 'del');
    const adds = rows.filter((r) => r.kind === 'add');
    expect(del?.oldNo).toBe(3);
    expect(del?.newNo).toBeNull();
    expect(adds[0].newNo).toBe(3);
    expect(adds[0].oldNo).toBeNull();
    expect(adds[1].newNo).toBe(4);
  });

  it('continues the correct counters after the hunk', () => {
    const rows = parseDiffLines(DIFF);
    const lastCtx = rows.filter((r) => r.kind === 'ctx').pop();
    expect(lastCtx?.oldNo).toBe(4);
    expect(lastCtx?.newNo).toBe(5);
  });

  it('resets counters at each new hunk', () => {
    const two = [DIFF, '@@ -20,1 +30,1 @@', ' another'].join('\n');
    const rows = parseDiffLines(two);
    const last = rows[rows.length - 1];
    expect(last.oldNo).toBe(20);
    expect(last.newNo).toBe(30);
  });

  it('treats header-like content lines inside a hunk as content', () => {
    const withSeparators = [
      'diff --git a/schema.sql b/schema.sql',
      '--- a/schema.sql',
      '+++ b/schema.sql',
      '@@ -1,2 +1,2 @@',
      '--- old separator',
      '+++ new separator',
    ].join('\n');
    const rows = parseDiffLines(withSeparators);
    expect(rows.filter((r) => r.kind === 'meta')).toHaveLength(3);
    expect(rows[4]).toMatchObject({ kind: 'del', text: '-- old separator', oldNo: 1 });
    expect(rows[5]).toMatchObject({ kind: 'add', text: '++ new separator', newNo: 1 });
  });
});

describe('pairDiffRows', () => {
  it('keeps headers full-width and pairs context lines with themselves', () => {
    const split = pairDiffRows(parseDiffLines(DIFF));
    expect(split[0].kind).toBe('header');
    expect(split.every((r) => r.kind === 'header' || r.kind === 'pair')).toBe(true);
    const ctxPair = split.find(
      (r) => r.kind === 'pair' && r.left?.kind === 'ctx' && r.right?.kind === 'ctx',
    );
    expect(ctxPair).toBeTruthy();
  });

  it('aligns a removal with its replacement on one row', () => {
    const split = pairDiffRows(parseDiffLines(DIFF));
    const replaced = split.find(
      (r) => r.kind === 'pair' && r.left?.text === 'old line' && r.right?.text === 'new line',
    );
    expect(replaced).toBeTruthy();
  });

  it('renders an insertion without a counterpart on an empty left side', () => {
    const split = pairDiffRows(parseDiffLines(DIFF));
    // "old line" is replaced by "new line", leaving "added line" unpaired.
    const inserted = split.find(
      (r) => r.kind === 'pair' && r.right?.text === 'added line',
    );
    expect(inserted && inserted.kind === 'pair' ? inserted.left : undefined).toBeNull();
  });

  it('pairs deletions and insertions by position inside one block', () => {
    const split = pairDiffRows(parseDiffLines([
      '@@ -1,2 +1,2 @@',
      '-a',
      '-b',
      '+c',
      '+d',
    ].join('\n')));
    // The hunk header is a full-width row; the block yields two pairs.
    expect(split[0].kind).toBe('header');
    const pairs = split.filter((r) => r.kind === 'pair');
    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toMatchObject({
      kind: 'pair',
      left: { text: 'a' },
      right: { text: 'c' },
    });
    expect(pairs[1]).toMatchObject({
      kind: 'pair',
      left: { text: 'b' },
      right: { text: 'd' },
    });
  });
});

describe('wordDiff', () => {
  function changedText(segments: ReturnType<typeof wordDiff>['left']) {
    return segments.filter((s) => s.changed).map((s) => s.text).join('');
  }

  it('highlights only the changed word inside a line', () => {
    const diff = wordDiff('const total = sum(a, b);', 'const total = sum(a, b, c);');
    expect(changedText(diff.left)).toBe('');
    expect(changedText(diff.right)).toBe(', c');
    // The unchanged remainder may be split across several runs, but every
    // segment on the old side is unchanged and reconstructs the original line.
    expect(diff.left.every((s) => !s.changed)).toBe(true);
    expect(diff.left.map((s) => s.text).join('')).toBe('const total = sum(a, b);');
  });

  it('marks both sides when a value is replaced', () => {
    const diff = wordDiff('let count = 1;', 'let count = 42;');
    expect(diff.left.some((s) => s.changed && s.text === '1')).toBe(true);
    expect(diff.right.some((s) => s.changed && s.text === '42')).toBe(true);
    expect(diff.left.some((s) => !s.changed && s.text.includes('let count'))).toBe(true);
  });

  it('returns no changed segments for identical lines', () => {
    const diff = wordDiff('same text', 'same text');
    expect(diff.left.every((s) => !s.changed)).toBe(true);
    expect(diff.right.every((s) => !s.changed)).toBe(true);
  });
});

describe('wordSegmentsByRow', () => {
  const rows = parseDiffLines([
    '@@ -1,2 +1,2 @@',
    '-let count = 1;',
    '+let count = 42;',
    ' unchanged line',
    '+only added',
  ].join('\n'));

  it('maps both sides of a replaced line to their word segments', () => {
    const map = wordSegmentsByRow(rows);
    const delIndex = rows.findIndex((r) => r.kind === 'del');
    const addIndex = rows.findIndex((r) => r.kind === 'add');
    expect(map.has(delIndex)).toBe(true);
    expect(map.has(addIndex)).toBe(true);
    expect(map.get(addIndex)?.some((s) => s.changed && s.text === '42')).toBe(true);
    expect(map.get(delIndex)?.some((s) => s.changed && s.text === '1')).toBe(true);
  });

  it('leaves context and one-sided additions unhighlighted', () => {
    const map = wordSegmentsByRow(rows);
    const ctxIndex = rows.findIndex((r) => r.kind === 'ctx');
    const loneAdd = rows.length - 1;
    expect(map.has(ctxIndex)).toBe(false);
    expect(map.has(loneAdd)).toBe(false);
  });
});
