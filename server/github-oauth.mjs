// GitHub App Device Flow login.
//
// The local product keeps its token bootstrap as the authentication boundary;
// this module adds an optional GitHub identity connection (login/avatar and
// App installation/repository discovery). The user access token never leaves
// the server: routes return only the connected identity, and the token is
// stored in config.json (0600) under github.oauth.
//
// The OAuth endpoints live on github.com, which may only be reachable through
// the system proxy; github-http.mjs carries that transport.

import { randomBytes } from 'node:crypto';
import { appendAudit, loadConfig, updateConfig } from './store.mjs';
import { fail, ok } from './http.mjs';
import { githubRequest } from './github-http.mjs';

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';
const INSTALLATIONS_URL = 'https://api.github.com/user/installations';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const FLOW_TTL_MS = 15 * 60_000;
const MAX_PENDING_FLOWS = 50;
const NETWORK_TIMEOUT_MS = 15_000;

/** Error carrying an HTTP status for the route layer. */
export class OAuthError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   * @param {Record<string, unknown>} [detail]
   */
  constructor(status, message, detail) {
super(message);
    this.name = 'OAuthError';
    this.status = status;
    this.detail = detail;
  }
}

/** @type {Map<string, { deviceCode: string, interval: number, expiresAt: number }>} */
const pendingFlows = new Map();

/**
 * Device Flow only needs the client id; the app slug is optional and used for
 * the install link. Deliberately not parseGithubAppConfig(): that helper
 * requires the client secret/private key, which this feature does not use.
 * @param {NodeJS.ProcessEnv} env
 */
export function oauthConfig(env = process.env) {
  const clientId = String(env.GITHUB_APP_CLIENT_ID ?? '').trim();
  const appSlug = String(env.GITHUB_APP_SLUG ?? '').trim();
  const missingEnv = [];
  if (!clientId) missingEnv.push('GITHUB_APP_CLIENT_ID');
  return {
    configured: Boolean(clientId),
    clientId,
    appSlug,
    installUrl: appSlug ? `https://github.com/apps/${encodeURIComponent(appSlug)}/installations/new` : null,
    missingEnv,
  };
}

/** @param {string} text */
function parseJson(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

/** @param {Map<string, { expiresAt: number }>} flows */
function sweepFlows(flows) {
  const now = Date.now();
  for (const [key, flow] of flows) {
    if (flow.expiresAt <= now) flows.delete(key);
  }
  while (flows.size >= MAX_PENDING_FLOWS) {
    const oldest = flows.keys().next().value;
    if (oldest === undefined) break;
    flows.delete(oldest);
  }
}

/**
 * Ask GitHub for a device code. The device code stays server-side; the caller
 * receives only the human code and the verification URL.
 * @param {NodeJS.ProcessEnv} env
 * @param {{ request?: typeof githubRequest }} [deps]
 */
export async function startDeviceFlow(env = process.env, deps = {}) {
  const config = oauthConfig(env);
  if (!config.configured) {
    throw new OAuthError(409, 'github oauth not configured', { missingEnv: config.missingEnv });
  }
  const request = deps.request ?? githubRequest;
  const response = await request(DEVICE_CODE_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: config.clientId }),
    timeoutMs: NETWORK_TIMEOUT_MS,
  });
  const payload = parseJson(response.text);
  if (payload.error) {
    if (payload.error === 'device_flow_disabled') {
      throw new OAuthError(400, 'device_flow_disabled', {
        hint: 'Enable Device Flow in the GitHub App settings (Optional features), then retry.',
      });
    }
    throw new OAuthError(400, payload.error_description || payload.error);
  }
  if (response.status < 200 || response.status >= 300 || !payload.device_code || !payload.user_code) {
    throw new OAuthError(502, 'github device flow failed', { status: response.status });
  }
  sweepFlows(pendingFlows);
  const flowId = randomBytes(18).toString('base64url');
  const expiresIn = Number(payload.expires_in) > 0 ? Number(payload.expires_in) : 900;
  pendingFlows.set(flowId, {
    deviceCode: String(payload.device_code),
    interval: Number(payload.interval) > 0 ? Number(payload.interval) : 5,
    expiresAt: Date.now() + Math.min(expiresIn * 1000, FLOW_TTL_MS),
  });
  return {
    flowId,
    userCode: String(payload.user_code),
    verificationUri: String(payload.verification_uri || 'https://github.com/login/device'),
    expiresIn,
    interval: Number(payload.interval) > 0 ? Number(payload.interval) : 5,
  };
}

/**
 * @param {string} token
 * @param {typeof fetch} fetchImpl
 */
async function fetchGithubUser(token, fetchImpl) {
  const response = await fetchImpl(USER_URL, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'pr-helper-git',
    },
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
  });
  if (!response.ok) throw new OAuthError(502, 'failed to read the GitHub user', { status: response.status });
  const user = await response.json();
  if (!user || typeof user.login !== 'string') throw new OAuthError(502, 'invalid GitHub user payload');
  return {
    login: String(user.login),
    githubUserId: typeof user.id === 'number' ? user.id : null,
    avatarUrl: typeof user.avatar_url === 'string' ? user.avatar_url : null,
  };
}

/**
 * One poll attempt. The caller decides how often to call it.
 * @param {NodeJS.ProcessEnv} env
 * @param {string} flowId
 * @param {{ request?: typeof githubRequest, fetchImpl?: typeof fetch }} [deps]
 */
export async function pollDeviceFlow(env = process.env, flowId, deps = {}) {
  const flow = pendingFlows.get(flowId);
  if (!flow || flow.expiresAt <= Date.now()) {
    pendingFlows.delete(flowId);
    throw new OAuthError(410, 'device flow expired');
  }
  const config = oauthConfig(env);
  if (!config.configured) {
    throw new OAuthError(409, 'github oauth not configured', { missingEnv: config.missingEnv });
  }
  const request = deps.request ?? githubRequest;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const response = await request(TOKEN_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: config.clientId,
      device_code: flow.deviceCode,
      grant_type: DEVICE_GRANT,
    }),
    timeoutMs: NETWORK_TIMEOUT_MS,
  });
  const payload = parseJson(response.text);

  if (payload.access_token) {
    const user = await fetchGithubUser(String(payload.access_token), fetchImpl);
    const connectedAt = new Date().toISOString();
    const expiresIn = Number(payload.expires_in);
    await saveOauthState({
      accessToken: String(payload.access_token),
      login: user.login,
      githubUserId: user.githubUserId,
      avatarUrl: user.avatarUrl,
      scopes: typeof payload.scope === 'string' ? payload.scope : '',
      connectedAt,
      ...(expiresIn > 0 ? { expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() } : {}),
    });
    pendingFlows.delete(flowId);
    return { state: 'connected', login: user.login };
  }

  switch (payload.error) {
    case 'authorization_pending':
      return { state: 'pending', interval: flow.interval };
    case 'slow_down':
      flow.interval += 5;
      return { state: 'slow_down', interval: flow.interval };
    case 'expired_token':
      pendingFlows.delete(flowId);
      return { state: 'expired' };
    case 'access_denied':
      pendingFlows.delete(flowId);
      return { state: 'denied' };
    case 'incorrect_device_code':
      pendingFlows.delete(flowId);
      return { state: 'error', message: payload.error_description || 'incorrect device code' };
    default:
      if (response.status >= 400) {
        pendingFlows.delete(flowId);
        return { state: 'error', message: payload.error_description || `GitHub token exchange failed (${response.status})` };
      }
      pendingFlows.delete(flowId);
      return { state: 'error', message: payload.error || 'GitHub authorization failed' };
  }
}

/** @param {{ accessToken: string, login: string, githubUserId?: number | null, avatarUrl?: string | null, scopes?: string, connectedAt: string, expiresAt?: string }} state */
export async function saveOauthState(state) {
  await updateConfig((config) => {
    const github = config.github && typeof config.github === 'object' ? config.github : {};
    github.oauth = state;
    config.github = github;
  });
}

export async function readOauthState() {
  const config = await loadConfig();
  const oauth = config && typeof config === 'object' && config.github && typeof config.github === 'object'
    ? config.github.oauth
    : null;
  if (!oauth || typeof oauth !== 'object' || typeof oauth.accessToken !== 'string' || !oauth.accessToken) return null;
  return oauth;
}

export async function clearOauthState() {
  await updateConfig((config) => {
    if (!config.github || typeof config.github !== 'object') return;
    delete config.github.oauth;
    if (!config.github.token) delete config.github;
  });
}

/**
 * @param {string} token
 * @param {typeof fetch} fetchImpl
 */
export async function listUserInstallations(token, fetchImpl = fetch) {
  const response = await fetchImpl(`${INSTALLATIONS_URL}?per_page=100`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'pr-helper-git',
    },
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
  });
  if (!response.ok) throw new OAuthError(502, 'failed to list GitHub App installations', { status: response.status });
  const payload = await response.json();
  const rows = Array.isArray(payload.installations) ? payload.installations : [];
  return rows.map((row) => ({
    id: row.id,
    account: typeof row.account?.login === 'string' ? row.account.login : null,
    targetType: row.target_type ?? null,
    repositorySelection: row.repository_selection ?? null,
  }));
}

/**
 * Status payload for the client. Never includes the access token.
 * @param {NodeJS.ProcessEnv} env
 */
export async function githubOauthStatus(env = process.env) {
  const config = oauthConfig(env);
  const oauth = await readOauthState();
  const expiresAt = oauth?.expiresAt ?? null;
  return {
    configured: config.configured,
    appSlug: config.appSlug || null,
    installUrl: config.installUrl,
    missingEnv: config.missingEnv,
    connected: Boolean(oauth),
    login: oauth?.login ?? null,
    avatarUrl: oauth?.avatarUrl ?? null,
    githubUserId: oauth?.githubUserId ?? null,
    connectedAt: oauth?.connectedAt ?? null,
    expiresAt,
    expired: Boolean(expiresAt && Number.isFinite(Date.parse(expiresAt)) && Date.parse(expiresAt) <= Date.now()),
  };
}

/**
 * Route handler, called inside the authenticated dispatch and before the Git
 * routes (which would otherwise reject unknown /api paths with a repo guard).
 * @param {{ method: string, pathname: string, body?: any, identity: any }} ctx
 */
export async function handleGithubOAuthRoute(ctx) {
  const { method, pathname, body, identity } = ctx;
  if (!pathname.startsWith('/api/auth/github/')) return null;

  const admin = identity?.role === 'admin';
  const requireAdmin = () => {
    if (!admin) return fail(403, 'admin access required');
    return null;
  };

  try {
    if (pathname === '/api/auth/github/status' && method === 'GET') {
      return ok(await githubOauthStatus());
    }

    if (pathname === '/api/auth/github/device/start' && method === 'POST') {
      const denied = requireAdmin();
      if (denied) return denied;
      const started = await startDeviceFlow();
      await appendAudit({ ok: true, action: 'github.oauth.start' });
      return ok(started);
    }

    if (pathname === '/api/auth/github/device/poll' && method === 'POST') {
      const denied = requireAdmin();
      if (denied) return denied;
      const flowId = typeof body?.flowId === 'string' ? body.flowId : '';
      if (!flowId) return fail(400, 'flowId is required');
      const result = await pollDeviceFlow(process.env, flowId);
      if (result.state === 'connected') {
        await appendAudit({ ok: true, action: 'github.oauth.connect', login: result.login });
      } else if (result.state === 'denied' || result.state === 'expired') {
        await appendAudit({ ok: false, action: 'github.oauth.denied' });
      }
      return ok(result);
    }

    if (pathname === '/api/auth/github/logout' && method === 'POST') {
      const denied = requireAdmin();
      if (denied) return denied;
      await clearOauthState();
      await appendAudit({ ok: true, action: 'github.oauth.logout' });
      return ok({ ok: true });
    }

if (pathname === '/api/auth/github/installations' && method === 'GET') {
      if (!identity || identity.role !== 'admin') return fail(403, 'admin access required');
      const oauth = await readOauthState();
      if (!oauth) return fail(409, 'github account not connected');
      const installations = await listUserInstallations(oauth.accessToken);
      return ok({ installations, installUrl: oauthConfig().installUrl });
    }

    return fail(404, 'unknown github oauth route');
  } catch (error) {
    if (error instanceof OAuthError) return fail(error.status, error.message, error.detail);
    return fail(502, error instanceof Error ? error.message : 'github oauth request failed');
  }
}
