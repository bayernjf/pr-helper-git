import { AsyncLocalStorage } from "node:async_hooks";
import { createGithubAppJwt } from "./github-app.mjs";
const githubApi = "https://api.github.com";
const GITHUB_REQUEST_TIMEOUT_MS = 15e3;
const INSTALLATION_TOKEN_REFRESH_BUFFER_MS = 6e4;
const installationTokenCache = /* @__PURE__ */ new Map();
const installationTokenRequests = /* @__PURE__ */ new Map();
const MAX_INSTALLATION_TOKEN_CACHE_ENTRIES = 500;
function cacheInstallationToken(key, entry) {
  if (entry.expiresAt <= Date.now() + INSTALLATION_TOKEN_REFRESH_BUFFER_MS) return;
  installationTokenCache.delete(key);
  installationTokenCache.set(key, entry);
  if (installationTokenCache.size <= MAX_INSTALLATION_TOKEN_CACHE_ENTRIES) return;
  const cutoff = Date.now() + INSTALLATION_TOKEN_REFRESH_BUFFER_MS;
  for (const [k, v] of installationTokenCache) {
    if (v.expiresAt <= cutoff) installationTokenCache.delete(k);
  }
  while (installationTokenCache.size > MAX_INSTALLATION_TOKEN_CACHE_ENTRIES) {
    const oldest = installationTokenCache.keys().next().value;
    if (oldest === void 0) break;
    installationTokenCache.delete(oldest);
  }
}
function installationTokenCacheSizeForTests() {
  return installationTokenCache.size;
}
const callStats = new AsyncLocalStorage();
async function trackGitHubCalls(run) {
  const stats = { calls: 0, totalMs: 0, slowest: null, etagStable: 0, etagChanged: 0, etagFirstSeen: 0 };
  const value = await callStats.run(stats, run);
  return { value, stats };
}
const etagMemo = /* @__PURE__ */ new Map();
const ETAG_MEMO_MAX = 4096;
function noteEtag(path, etag, stats) {
  if (!etag) return;
  if (etagMemo.size >= ETAG_MEMO_MAX) etagMemo.clear();
  const previous = etagMemo.get(path);
  etagMemo.set(path, etag);
  if (!stats) return;
  if (previous === void 0) stats.etagFirstSeen += 1;
  else if (previous === etag) stats.etagStable += 1;
  else stats.etagChanged += 1;
}
class GitHubApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = "GitHubApiError";
  }
}
function requestSignal(signal) {
  const timeout = AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS);
  return { timeout, signal: signal ? AbortSignal.any([signal, timeout]) : timeout };
}
async function githubResponse(path, token, init) {
  const stats = callStats.getStore();
  const startedAt = stats ? performance.now() : 0;
  try {
    return await githubFetch(path, token, init);
  } finally {
    if (stats) {
      const ms = Math.round(performance.now() - startedAt);
      stats.calls += 1;
      stats.totalMs += ms;
      if (!stats.slowest || ms > stats.slowest.ms) stats.slowest = { path, ms };
    }
  }
}
async function githubFetch(path, token, init) {
  const { timeout, signal } = requestSignal(init?.signal);
  let response;
  try {
    response = await fetch(`${githubApi}${path}`, {
      ...init,
      signal,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...init?.headers
      }
    });
  } catch (error) {
    if (timeout.aborted) throw new Error("GitHub \u8BF7\u6C42\u8D85\u65F6\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5");
    throw error;
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => ({ message: response.statusText }));
    throw new GitHubApiError(response.status, detail.message || `GitHub \u8BF7\u6C42\u5931\u8D25 (${response.status})`);
  }
  if ((init?.method ?? "GET") === "GET") noteEtag(path, response.headers.get("etag"), callStats.getStore());
  if (response.status === 204 || response.headers.get("content-length") === "0") return {};
  return response.json();
}
function githubAppRequest(config, path, init) {
  return githubResponse(path, createGithubAppJwt(config), init);
}
async function installationAccessToken(config, installationId) {
  const key = `${config.appId}:${installationId}`;
  const cached = installationTokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + INSTALLATION_TOKEN_REFRESH_BUFFER_MS) return cached.token;
  if (cached) installationTokenCache.delete(key);
  const inFlight = installationTokenRequests.get(key);
  if (inFlight) return inFlight;
  const request = githubAppRequest(config, `/app/installations/${encodeURIComponent(installationId)}/access_tokens`, { method: "POST" }).then((result) => {
    const expiresAt = Date.parse(result.expires_at || "") || Date.now() + 55 * 6e4;
    cacheInstallationToken(key, { token: result.token, expiresAt });
    return result.token;
  }).finally(() => installationTokenRequests.delete(key));
  installationTokenRequests.set(key, request);
  return request;
}
function installationRequest(config, installationId, path, init) {
  return installationAccessToken(config, installationId).then((token) => githubResponse(path, token, init));
}
export {
  GitHubApiError,
  githubAppRequest,
  installationAccessToken,
  installationRequest,
  installationTokenCacheSizeForTests,
  trackGitHubCalls
};
