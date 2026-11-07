import { describe, expect, it } from 'vitest';
import { windowRange } from './virtual-range';

describe('windowRange', () => {
  it('covers the viewport plus overscan', () => {
    // 100 rows of 30px, viewport 300px, scrolled to row 10.
    expect(windowRange(100, 300, 300, 30, 5)).toEqual({ start: 5, end: 25 });
  });

  it('clamps at the top and the bottom', () => {
    expect(windowRange(100, 0, 300, 30, 5)).toEqual({ start: 0, end: 15 });
    expect(windowRange(100, 2700, 300, 30, 5)).toEqual({ start: 85, end: 100 });
  });

  it('returns an empty range for empty lists or invalid metrics', () => {
    expect(windowRange(0, 0, 300, 30)).toEqual({ start: 0, end: 0 });
    expect(windowRange(10, 0, 300, 0)).toEqual({ start: 0, end: 0 });
  });
});
