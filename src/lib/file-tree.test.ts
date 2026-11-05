import { describe, expect, it } from 'vitest';
import type { StatusFile } from '../types';
import { buildFileTree, flattenTree } from './file-tree';

function file(path: string): StatusFile {
  return { path, status: 'M', area: 'unstaged' };
}

describe('buildFileTree', () => {
  it('returns an empty array for no files', () => {
    expect(buildFileTree([])).toEqual([]);
  });

  it('nests files under shared folders', () => {
    const tree = buildFileTree([file('src/a.js'), file('src/b.js')]);
    expect(tree).toHaveLength(1);
    const src = tree[0];
    expect(src.folder).toBe(true);
    expect(src.name).toBe('src');
    expect(src.children.map((c) => c.name)).toEqual(['a.js', 'b.js']);
  });

  it('sorts folders before files, then alphabetically', () => {
    const tree = buildFileTree([
      file('z.txt'),
      file('a/deep/x.js'),
      file('a.txt'),
    ]);
    expect(tree[0].folder).toBe(true);
    expect(tree[0].name).toBe('a');
    expect(tree.slice(1).map((n) => n.name)).toEqual(['a.txt', 'z.txt']);
  });

  it('tracks depth and full path on each node', () => {
    const tree = buildFileTree([file('a/b/c.js')]);
    const a = tree[0];
    const b = a.children[0];
    const c = b.children[0];
    expect(a.depth).toBe(0);
    expect(b.depth).toBe(1);
    expect(c.depth).toBe(2);
    expect(c.path).toBe('a/b/c.js');
    expect(c.file?.path).toBe('a/b/c.js');
  });
});

describe('flattenTree', () => {
  const tree = buildFileTree([
    file('src/a.js'),
    file('src/nested/b.js'),
    file('top.txt'),
  ]);

  it('flattens every expanded node by default', () => {
    const rows = flattenTree(tree, new Set());
    // Inside src the nested folder sorts before the a.js file.
    expect(rows.map((r) => r.path)).toEqual([
      'src',
      'src/nested',
      'src/nested/b.js',
      'src/a.js',
      'top.txt',
    ]);
  });

  it('skips children of collapsed folders', () => {
    const rows = flattenTree(tree, new Set(['src']));
    expect(rows.map((r) => r.path)).toEqual(['src', 'top.txt']);
  });
});
