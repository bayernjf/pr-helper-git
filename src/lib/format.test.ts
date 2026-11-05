import { describe, expect, it } from 'vitest';
import { formatRelative, pluralize, shortHash } from './format';

describe('format helpers', () => {
  it('shortens hashes to seven characters', () => {
    expect(shortHash('abcdef1234567890')).toBe('abcdef1');
  });

  it('renders relative time text', () => {
    const recent = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    expect(formatRelative(recent)).toContain('ago');
  });

  it('pluralizes counts', () => {
    expect(pluralize(1, 'file')).toBe('1 file');
    expect(pluralize(2, 'file')).toBe('2 files');
  });
});
