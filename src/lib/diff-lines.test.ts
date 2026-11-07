import { describe, expect, it } from 'vitest';
import { parseDiffLines } from './diff-lines';

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
