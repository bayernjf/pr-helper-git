// Regression: config.github now carries two independent things — the
// server-side PAT (config.github.token) and the optional GitHub OAuth
// connection (config.github.oauth). Storing or clearing one must not erase the
// other. Uses the real store against an isolated PR_HELPER_HOME.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let tmpRoot;
let store;
let handleGitMeta;

beforeAll(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'git2-pat-oauth-'));
  process.env.PR_HELPER_HOME = tmpRoot;
  store = await import('./store.mjs');
  ({ handleGitMeta } = await import('./routes-git-meta.mjs'));
});

afterAll(async () => {
  delete process.env.PR_HELPER_HOME;
  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

function call(method, pathname, body) {
  return handleGitMeta({
    method,
    pathname,
    body,
    identity: { name: 'owner', role: 'admin', instance: true },
    query: new URLSearchParams(),
  });
}

describe('server PAT and GitHub OAuth share config.github', () => {
  it('keeps the OAuth connection when the PAT is stored and removed', async () => {
    await store.updateConfig((config) => {
      config.github = {
        oauth: { accessToken: 'ghu_secret', login: 'octocat', connectedAt: '2026-11-15T00:00:00.000Z' },
      };
    });

    const stored = await call('POST', '/api/pat', { pat: 'ghp_test' });
    expect(stored.status).toBe(200);
    let config = await store.loadConfig();
    expect(config.github.oauth.login).toBe('octocat');
    expect(config.github.token).toBe('ghp_test');

    const cleared = await call('DELETE', '/api/pat', {});
    expect(cleared.status).toBe(200);
    config = await store.loadConfig();
    expect(config.github.oauth.login).toBe('octocat');
    expect(config.github.token).toBeUndefined();
  });

  it('drops config.github when the PAT was its last field', async () => {
    await store.updateConfig((config) => {
      config.github = { token: 'ghp_only' };
    });

    const cleared = await call('DELETE', '/api/pat', {});
    expect(cleared.status).toBe(200);
    const config = await store.loadConfig();
    expect(config.github).toBeUndefined();
  });
});
