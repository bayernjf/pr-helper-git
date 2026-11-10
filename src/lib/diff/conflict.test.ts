import { describe, expect, it } from 'vitest';
import {
  assembleResolved,
  hasConflictMarkers,
  parseConflictMarkers,
} from './conflict';

const DEFAULT_MARKERS = [
  'before',
  '<<<<<<< HEAD',
  'ours line',
  '=======',
  'theirs line',
  '>>>>>>> feature',
  'after',
].join('\n');

const DIFF3_MARKERS = [
  'before',
  '<<<<<<< HEAD',
  'ours line',
  '||||||| base',
  'base line',
  '=======',
  'theirs line',
  '>>>>>>> feature',
  'after',
].join('\n');

describe('conflict marker parsing', () => {
  it('parses default ours/theirs markers with surrounding text', () => {
    const segments = parseConflictMarkers(DEFAULT_MARKERS);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({ type: 'text', text: 'before' });
    expect(segments[1]).toEqual({
      type: 'conflict',
      region: { ours: 'ours line', base: null, theirs: 'theirs line' },
    });
    expect(segments[2]).toEqual({ type: 'text', text: 'after' });
    expect(hasConflictMarkers(DEFAULT_MARKERS)).toBe(true);
  });

  it('keeps the base section for diff3 markers', () => {
    const segments = parseConflictMarkers(DIFF3_MARKERS);
    const conflict = segments.find((s) => s.type === 'conflict');
    expect(conflict).toEqual({
      type: 'conflict',
      region: { ours: 'ours line', base: 'base line', theirs: 'theirs line' },
    });
  });

  it('does not report ordinary text as a conflict', () => {
    const segments = parseConflictMarkers('a\nb\n');
    expect(segments).toEqual([{ type: 'text', text: 'a\nb\n' }]);
    expect(hasConflictMarkers('a\nb\n')).toBe(false);
  });

  it('handles multiple conflict regions independently', () => {
    const content = [
      '<<<<<<< HEAD',
      'one-ours',
      '=======',
      'one-theirs',
      '>>>>>>> x',
      'middle',
      '<<<<<<< HEAD',
      'two-ours',
      '=======',
      'two-theirs',
      '>>>>>>> y',
    ].join('\n');
    const segments = parseConflictMarkers(content);
    expect(segments.filter((s) => s.type === 'conflict')).toHaveLength(2);
  });
});

describe('conflict assembly', () => {
  it('chooses ours, theirs, or both per region', () => {
    const segments = parseConflictMarkers(DEFAULT_MARKERS);
    expect(assembleResolved(segments, ['ours'])).toBe('before\nours line\nafter');
    expect(assembleResolved(segments, ['theirs'])).toBe('before\ntheirs line\nafter');
    expect(assembleResolved(segments, ['both'])).toBe('before\nours line\ntheirs line\nafter');
  });

  it('defaults to ours when a decision is missing', () => {
    const segments = parseConflictMarkers(DEFAULT_MARKERS);
    expect(assembleResolved(segments, [])).toBe('before\nours line\nafter');
  });

  it('preserves a trailing newline from the working file', () => {
    const segments = parseConflictMarkers(`${DEFAULT_MARKERS}\n`);
    expect(assembleResolved(segments, ['theirs'])).toBe('before\ntheirs line\nafter\n');
  });
});
