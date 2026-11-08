import { describe, expect, it } from 'vitest';
import { parseGrepLines } from './routes-git.mjs';

describe('parseGrepLines', () => {
  it('parses several matches without swallowing the next path', () => {
    const raw = `a file.ts\0${1}\0const needle = 1;\nsrc/b.ts\0${12}\0needle again\n`;
    expect(parseGrepLines(raw)).toEqual([
      { path: 'a file.ts', line: 1, text: 'const needle = 1;' },
      { path: 'src/b.ts', line: 12, text: 'needle again' },
    ]);
  });

  it('keeps a path that contains a colon', () => {
    expect(parseGrepLines(`colon:name.ts\0${1}\0needle\n`)).toEqual([
      { path: 'colon:name.ts', line: 1, text: 'needle' },
    ]);
  });

  it('handles an empty matched line and empty output', () => {
    expect(parseGrepLines(`a.ts\0${3}\0\n`)).toEqual([{ path: 'a.ts', line: 3, text: '' }]);
    expect(parseGrepLines('')).toEqual([]);
  });
});
