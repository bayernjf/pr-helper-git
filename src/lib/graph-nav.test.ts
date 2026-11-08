import { describe, expect, it } from 'vitest';
import { isGraphNavKey, nextCommitIndex, pageSizeForViewport } from './graph-nav';

describe('commit graph keyboard navigation', () => {
  it('only claims the keys it handles', () => {
    expect(isGraphNavKey('ArrowDown')).toBe(true);
    expect(isGraphNavKey('PageDown')).toBe(true);
    expect(isGraphNavKey('Escape')).toBe(true);
    expect(isGraphNavKey('Enter')).toBe(false);
    expect(isGraphNavKey('a')).toBe(false);
  });

  it('lands on the first row going down from nothing and the last going up', () => {
    expect(nextCommitIndex('ArrowDown', -1, 5, 8)).toBe(0);
    expect(nextCommitIndex('ArrowUp', -1, 5, 8)).toBe(4);
  });

  it('clamps at both ends instead of wrapping', () => {
    expect(nextCommitIndex('ArrowDown', 4, 5, 8)).toBe(4);
    expect(nextCommitIndex('ArrowUp', 0, 5, 8)).toBe(0);
    expect(nextCommitIndex('Home', 3, 5, 8)).toBe(0);
    expect(nextCommitIndex('End', 1, 5, 8)).toBe(4);
  });

  it('pages by the viewport size and stays inside the list', () => {
    expect(nextCommitIndex('PageDown', 0, 30, 10)).toBe(10);
    expect(nextCommitIndex('PageDown', 25, 30, 10)).toBe(29);
    expect(nextCommitIndex('PageUp', 12, 30, 10)).toBe(2);
    expect(nextCommitIndex('PageUp', 3, 30, 10)).toBe(0);
  });

  it('clears the selection on Escape and does nothing on an empty list', () => {
    expect(nextCommitIndex('Escape', 2, 5, 8)).toBeNull();
    expect(nextCommitIndex('ArrowDown', -1, 0, 8)).toBeNull();
  });

  it('derives a page size that always moves at least one row', () => {
    expect(pageSizeForViewport(340, 34)).toBe(9);
    expect(pageSizeForViewport(0, 34)).toBe(1);
    expect(pageSizeForViewport(100, 0)).toBe(1);
  });
});
