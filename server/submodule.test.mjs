// `git submodule status` is plain text with a one-character state prefix; these
// cases document the four prefixes and the optional "(describe)" suffix.
import { describe, expect, it } from 'vitest';
import { parseSubmoduleStatus } from './git.mjs';

describe('parseSubmoduleStatus', () => {
  it('reads the four state prefixes', () => {
    const out = [
      ' aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111 vendor/lib (v1.0)',
      '-bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222 vendor/offline',
      '+cccc3333cccc3333cccc3333cccc3333cccc3333 vendor/ahead (v2.0-3-gabc)',
      'Udddd4444dddd4444dddd4444dddd4444dddd4444 vendor/conflict',
    ].join('\n');
    const entries = parseSubmoduleStatus(out);
    expect(entries.map((e) => e.state)).toEqual([' ', '-', '+', 'U']);
    expect(entries.map((e) => e.path)).toEqual([
      'vendor/lib', 'vendor/offline', 'vendor/ahead', 'vendor/conflict',
    ]);
    expect(entries[0].describe).toBe('v1.0');
    expect(entries[1].describe).toBe('');
  });

  it('ignores blank and unrecognised lines', () => {
    expect(parseSubmoduleStatus('\n  \nnoise line\n')).toEqual([]);
    expect(parseSubmoduleStatus('')).toEqual([]);
  });
});
