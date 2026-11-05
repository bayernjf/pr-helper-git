// GitHub REST proxy. The PAT arrives per request in the x-github-pat header,
// is never persisted, and only an allowlist of repo/pull-request endpoints
// can be reached.
import { git } from './git.mjs';
import { appendAudit } from './store.mjs';

const GITHUB_API = 'https://api.github.com';
const GITHUB_TIMEOUT_MS = 20_000;
const SEG = '[\\w.-]+';

const ALLOWLIST = [
  {
    method: 'GET',
    regex: new RegExp(`^/repos/${SEG}/${SEG}/pulls(/\\d+(/(commits|files|requested-reviewers))?)?$`),
  },
  {
    method: 'GET',
    regex: new RegExp(`^/repos/${SEG}/${SEG}/commits/${SEG}/check-runs$`),
  },
  { method: 'GET', regex: new RegExp(`^/repos/${SEG}/${SEG}/branches(/${SEG})?$`) },
  { method: 'GET', regex: new RegExp(`^/repos/${SEG}/${SEG}$`) },
  { method: 'GET', regex: /^\/user$/ },
  { method: 'POST', regex: new RegExp(`^/repos/${SEG}/${SEG}/pulls$`) },
  { method: 'POST', regex: new RegExp(`^/repos/${SEG}/${SEG}/pulls/\\d+/merge$`) },
  { method: 'PATCH', regex: new RegExp(`^/repos/${SEG}/${SEG}/pulls/\\d+$`) },
];

const ok = (json, status = 200) => ({ status, json });
const fail = (status, error, detail) => ({ status, json: { error, ...(detail ? { detail } : {}) } });

function isAllowed(method, path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('..')) return false;
  return ALLOWLIST.some((entry) => entry.method === method && entry.regex.test(path));
}

// Parse an origin remote URL into owner/repo when hosted on GitHub.
export function parseRemoteUrl(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url) return null;
  let match = url.match(/^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (!match) {
    match = url.match(/^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  }
  if (!match) return { url, isGithub: false };
  return { url, isGithub: true, owner: match[1], repo: match[2] };
}

export async function handleGithubRoute({ method, pathname, query, body, headers }) {
  if (pathname === '/api/remote' && method === 'GET') {
    const repo = typeof query.get('repo') === 'string' ? query.get('repo') : '';
    try {
      const url = (await git(['remote', 'get-url', 'origin'], repo)).trim();
      return ok({ remote: parseRemoteUrl(url) });
    } catch (err) {
      return ok({ remote: null, detail: err.stderr || err.message });
    }
  }

  if (pathname !== '/api/github' || method !== 'POST') return null;

  const pat = String(headers['x-github-pat'] || '').trim();
  if (!pat) return fail(401, 'missing GitHub token');
  const ghMethod = typeof body.method === 'string' ? body.method.toUpperCase() : 'GET';
  const ghPath = typeof body.path === 'string' ? body.path.trim() : '';
  if (!['GET', 'POST', 'PATCH', 'PUT'].includes(ghMethod)) {
    return fail(400, 'method not allowed');
  }
  if (!isAllowed(ghMethod, ghPath)) return fail(403, 'endpoint not in allowlist');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GITHUB_TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(`${GITHUB_API}${ghPath}`, {
      method: ghMethod,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${pat}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'pr-helper-git2',
      },
      body: ghMethod === 'GET' ? undefined : JSON.stringify(body.payload || {}),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    await appendAudit({ ok: false, action: 'github', method: ghMethod, path: ghPath });
    return fail(err.name === 'AbortError' ? 504 : 502, 'GitHub request failed', err.message);
  }
  clearTimeout(timer);
  const text = await upstream.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  await appendAudit({
    ok: upstream.ok,
    action: 'github',
    method: ghMethod,
    path: ghPath,
    upstreamStatus: upstream.status,
  });
  return { status: upstream.status, json: { status: upstream.status, data } };
}
