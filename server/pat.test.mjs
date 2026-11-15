import { describe, expect, it } from 'vitest';
import { hasServerPat, serverPatFrom } from './pat.mjs';

describe('server PAT resolution', () => {
  it('prefers the PAT stored through the UI', () => {
    expect(serverPatFrom({ github: { token: 'ui-token' } }, { GITHUB_TOKEN: 'env-token' })).toBe('ui-token');
  });

  it('falls back to GITHUB_TOKEN from credentials.env', () => {
    expect(serverPatFrom({}, { GITHUB_TOKEN: 'env-token' })).toBe('env-token');
    expect(hasServerPat({}, { GITHUB_TOKEN: 'env-token' })).toBe(true);
  });

  it('treats missing values and whitespace as absent', () => {
    expect(serverPatFrom({}, {})).toBe('');
    expect(serverPatFrom({ github: { token: '   ' } }, { GITHUB_TOKEN: '  ' })).toBe('');
    expect(hasServerPat({}, {})).toBe(false);
  });
});
