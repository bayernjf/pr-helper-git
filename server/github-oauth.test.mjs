import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  config: /** @type {any} */ ({ repos: [], users: [] }),
  audits: /** @type {any[]} */ ([]),
}));

vi.mock('./store.mjs', () => ({
  loadConfig: vi.fn(async () => structuredClone(state.config)),
  updateConfig: vi.fn(async (mutator) => {
    const config = structuredClone(state.config);
    const outcome = await mutator(config);
    state.config = config;
    return outcome && Object.prototype.hasOwnProperty.call(outcome, 'value') ? outcome.value : outcome;
  }),
  appendAudit: vi.fn(async (entry) => {
    state.audits.push(entry);
  }),
}));

vi.mock('./github-http.mjs', () => ({
  githubRequest: vi.fn(),
}));

import { githubRequest } from './github-http.mjs';
import {
  clearOauthState,
  githubOauthStatus,
  handleGithubOAuthRoute,
  oauthConfig,
  pollDeviceFlow,
  readOauthState,
  saveOauthState,
  startDeviceFlow,
} from './github-oauth.mjs';

const request = vi.mocked(githubRequest);
const ENV = { GITHUB_APP_CLIENT_ID: 'Iv23test', GITHUB_APP_SLUG: 'pr-helper-by-test' };

function jsonResponse(value) {
  return { status: 200, headers: {}, text: JSON.stringify(value) };
}

beforeEach(() => {
  state.config = { repos: [], users: [] };
  state.audits = [];
  request.mockReset();
});

describe('oauthConfig', () => {
  it('requires only the client id', () => {
    expect(oauthConfig({})).toMatchObject({ configured: false, missingEnv: ['GITHUB_APP_CLIENT_ID'] });
    expect(oauthConfig(ENV)).toMatchObject({
      configured: true,
      appSlug: 'pr-helper-by-test',
      installUrl: 'https://github.com/apps/pr-helper-by-test/installations/new',
      missingEnv: [],
    });
  });
});

describe('device flow', () => {
  it('starts a flow without returning the device code', async () => {
    request.mockResolvedValueOnce(jsonResponse({
      device_code: 'device-secret',
      user_code: 'ABCD-1234',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900,
      interval: 5,
    }));
    const started = await startDeviceFlow(ENV, { request });
    expect(started).toMatchObject({ userCode: 'ABCD-1234', interval: 5, expiresIn: 900 });
    expect(JSON.stringify(started)).not.toContain('device-secret');
    expect(request).toHaveBeenCalledWith('https://github.com/login/device/code', expect.objectContaining({ method: 'POST' }));
  });

  it('maps a disabled device flow to an actionable error', async () => {
    request.mockResolvedValueOnce(jsonResponse({ error: 'device_flow_disabled' }));
    await expect(startDeviceFlow(ENV, { request })).rejects.toMatchObject({
      status: 400,
      message: 'device_flow_disabled',
    });
  });

  it('reports pending and backs off on slow_down', async () => {
    request.mockResolvedValueOnce(jsonResponse({ device_code: 'dc', user_code: 'CODE', interval: 5 }));
    const started = await startDeviceFlow(ENV, { request });

    request.mockResolvedValueOnce(jsonResponse({ error: 'authorization_pending' }));
    await expect(pollDeviceFlow(ENV, started.flowId, { request })).resolves.toMatchObject({ state: 'pending', interval: 5 });

    request.mockResolvedValueOnce(jsonResponse({ error: 'slow_down' }));
    await expect(pollDeviceFlow(ENV, started.flowId, { request })).resolves.toMatchObject({ state: 'slow_down', interval: 10 });

    request.mockResolvedValueOnce(jsonResponse({ error: 'authorization_pending' }));
    await expect(pollDeviceFlow(ENV, started.flowId, { request })).resolves.toMatchObject({ state: 'pending', interval: 10 });
  });

  it('stores the connected identity and never returns the token', async () => {
    request.mockResolvedValueOnce(jsonResponse({ device_code: 'dc', user_code: 'CODE', interval: 5 }));
    const started = await startDeviceFlow(ENV, { request });
    request.mockResolvedValueOnce(jsonResponse({ access_token: 'ghu_secret', scope: '', token_type: 'bearer' }));
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ login: 'octocat', id: 7, avatar_url: 'https://avatars.example/octocat' }),
    }));

    const result = await pollDeviceFlow(ENV, started.flowId, { request, fetchImpl });
    expect(result).toEqual({ state: 'connected', login: 'octocat' });
    expect(state.config.github.oauth).toMatchObject({
      accessToken: 'ghu_secret',
      login: 'octocat',
      githubUserId: 7,
      avatarUrl: 'https://avatars.example/octocat',
    });

    const status = await githubOauthStatus(ENV);
    expect(status).toMatchObject({ connected: true, login: 'octocat', configured: true });
    expect(JSON.stringify(status)).not.toContain('ghu_secret');
  });

  it('maps denied and expired polls', async () => {
    request.mockResolvedValueOnce(jsonResponse({ device_code: 'dc', user_code: 'CODE', interval: 5 }));
    const denied = await startDeviceFlow(ENV, { request });
    request.mockResolvedValueOnce(jsonResponse({ error: 'access_denied' }));
    await expect(pollDeviceFlow(ENV, denied.flowId, { request })).resolves.toEqual({ state: 'denied' });

    request.mockResolvedValueOnce(jsonResponse({ device_code: 'dc2', user_code: 'CODE2', interval: 5 }));
    const expired = await startDeviceFlow(ENV, { request });
    request.mockResolvedValueOnce(jsonResponse({ error: 'expired_token' }));
    await expect(pollDeviceFlow(ENV, expired.flowId, { request })).resolves.toEqual({ state: 'expired' });
  });

  it('rejects an unknown flow id', async () => {
    await expect(pollDeviceFlow(ENV, 'missing-flow', { request })).rejects.toMatchObject({ status: 410 });
  });
});

describe('connection state', () => {
  it('preserves an existing server PAT when saving and clearing the connection', async () => {
    state.config = { repos: [], users: [], github: { token: 'ghp_keep' } };
    await saveOauthState({ accessToken: 'ghu_x', login: 'octocat', connectedAt: '2026-11-15T00:00:00.000Z' });
    expect(state.config.github).toMatchObject({ token: 'ghp_keep', oauth: { login: 'octocat' } });
    await expect(readOauthState()).resolves.toMatchObject({ login: 'octocat' });

    await clearOauthState();
    expect(state.config.github).toEqual({ token: 'ghp_keep' });
    await expect(readOauthState()).resolves.toBeNull();
  });

  it('flags an expired user token in the status payload', async () => {
    await saveOauthState({
      accessToken: 'ghu_x',
      login: 'octocat',
      connectedAt: '2026-11-15T00:00:00.000Z',
      expiresAt: '2020-01-01T00:00:00.000Z',
    });
    await expect(githubOauthStatus(ENV)).resolves.toMatchObject({ connected: true, expired: true });
  });
});

describe('handleGithubOAuthRoute', () => {
  it('ignores unrelated paths', async () => {
    await expect(handleGithubOAuthRoute({ method: 'GET', pathname: '/api/pat', identity: { role: 'admin' } }))
      .resolves.toBeNull();
  });

  it('lets members read the status but not start a flow', async () => {
    const previous = process.env.GITHUB_APP_CLIENT_ID;
    process.env.GITHUB_APP_CLIENT_ID = ENV.GITHUB_APP_CLIENT_ID;
    try {
      const status = await handleGithubOAuthRoute({
        method: 'GET',
        pathname: '/api/auth/github/status',
        identity: { role: 'member' },
      });
      expect(status.status).toBe(200);
      expect(status.json.connected).toBe(false);

      const start = await handleGithubOAuthRoute({
        method: 'POST',
        pathname: '/api/auth/github/device/start',
        identity: { role: 'member' },
      });
      expect(start.status).toBe(403);
    } finally {
      if (previous === undefined) delete process.env.GITHUB_APP_CLIENT_ID;
      else process.env.GITHUB_APP_CLIENT_ID = previous;
    }
  });

  it('returns 409 when the client id is missing', async () => {
    const previous = process.env.GITHUB_APP_CLIENT_ID;
    delete process.env.GITHUB_APP_CLIENT_ID;
    try {
      const response = await handleGithubOAuthRoute({
        method: 'POST',
        pathname: '/api/auth/github/device/start',
        identity: { role: 'admin' },
      });
      expect(response.status).toBe(409);
      expect(response.json.detail).toMatchObject({ missingEnv: ['GITHUB_APP_CLIENT_ID'] });
    } finally {
      if (previous !== undefined) process.env.GITHUB_APP_CLIENT_ID = previous;
    }
  });
});
