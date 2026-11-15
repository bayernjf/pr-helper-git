import { describe, expect, it } from 'vitest';
import { parseCredentialEnv } from './credentials-env.mjs';

describe('parseCredentialEnv', () => {
  it('strips matching outer quotes from credential values', () => {
    expect(parseCredentialEnv('GITHUB_TOKEN="ghp_example"\nDATABASE_URL="postgres://x"')).toEqual({
      GITHUB_TOKEN: 'ghp_example',
      DATABASE_URL: 'postgres://x',
    });
  });

  it('keeps unquoted and escaped-newline values intact', () => {
    expect(parseCredentialEnv('GITHUB_APP_PRIVATE_KEY="line1\\nline2"\nA=plain')).toEqual({
      GITHUB_APP_PRIVATE_KEY: 'line1\\nline2',
      A: 'plain',
    });
  });

  it('ignores empty, sensitive-masked and malformed lines', () => {
    expect(parseCredentialEnv('EMPTY=\nMASKED=[SENSITIVE]\nBAD-KEY=x\nok=yes')).toEqual({});
  });
});
