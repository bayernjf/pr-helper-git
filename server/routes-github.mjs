// GitHub REST proxy. The PAT arrives per request in the x-github-pat header,
// is never persisted, and only an allowlist of repo/pull-request endpoints
// can be reached.
import { git } from './git.mjs';
import { appendAudit, listRepos } from './store.mjs';

const GITHUB_API = 'https://api.github.com';
const GITHUB_TIMEOUT_MS = 20_000;
const SEG = '[\\w.-]+';

const ALLOWLIST = [
  {
    method: 'GET',
    regex: new RegExp(`^/repos/${SEG}/${SEG}/pulls(/\\d+(/(commits|files|requested-reviewers|reviews))?)?$`),
  },
  {
    method: 'GET',
    regex: new RegExp(`^/repos/${SEG}/${SEG}/commits/${SEG}/check-runs$`),
  },
  { method: 'GET', regex: new RegExp(`^/repos/${SEG}/${SEG}/branches(/${SEG})?$`) },
  { method: 'GET', regex: new RegExp(`^/repos/${SEG}/${SEG}/issues/\\d+/comments$`) },
  // Line-level review comments live under pulls (not issues); POST anchors a
  // comment to a commit/path/line inside a PR diff.
  {
    method: 'GET',
    regex: new RegExp(`^/repos/${SEG}/${SEG}/pulls/\\d+/comments$`),
  },
  {
    method: 'POST',
    regex: new RegExp(`^/repos/${SEG}/${SEG}/pulls/\\d+/comments$`),
  },
  // GitHub locates a single comment at issues/comments/:cid (no issue number);
  // the nested .../issues/:n/comments/:cid form returns 404 upstream.
  {
    method: 'PATCH',
    regex: new RegExp(`^/repos/${SEG}/${SEG}/issues/comments/\\d+$`),
  },
  {
    method: 'DELETE',
    regex: new RegExp(`^/repos/${SEG}/${SEG}/issues/comments/\\d+$`),
  },
  // Line-level review comments use the flat pulls/comments/:cid endpoint
  // (distinct from the issues/comments path used for issue-level comments).
  {
    method: 'PATCH',
    regex: new RegExp(`^/repos/${SEG}/${SEG}/pulls/comments/\\d+$`),
  },
  {
    method: 'DELETE',
    regex: new RegExp(`^/repos/${SEG}/${SEG}/pulls/comments/\\d+$`),
  },
  { method: 'GET', regex: new RegExp(`^/repos/${SEG}/${SEG}$`) },
  { method: 'GET', regex: /^\/user$/ },
  { method: 'POST', regex: new RegExp(`^/repos/${SEG}/${SEG}/pulls$`) },
  { method: 'POST', regex: new RegExp(`^/repos/${SEG}/${SEG}/issues/\\d+/comments$`) },
  { method: 'POST', regex: new RegExp(`^/repos/${SEG}/${SEG}/pulls/\\d+/requested-reviewers$`) },
  { method: 'POST', regex: new RegExp(`^/repos/${SEG}/${SEG}/pulls/\\d+/reviews$`) },
  { method: 'POST', regex: new RegExp(`^/repos/${SEG}/${SEG}/pulls/\\d+/merge$`) },
  { method: 'PATCH', regex: new RegExp(`^/repos/${SEG}/${SEG}/pulls/\\d+$`) },
];

const ok = (json, status = 200) => ({ status, json });
const fail = (status, error, detail) => ({ status, json: { error, ...(detail ? { detail } : {}) } });

// Minimal GitHub GraphQL caller used for the draft -> ready conversion, which
// the REST endpoint silently ignores.
async function githubGraphql(pat, query, variables) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GITHUB_TIMEOUT_MS);
  try {
    const response = await fetch(`${GITHUB_API}/graphql`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pat}`,
        'content-type': 'application/json',
        'user-agent': 'pr-helper-git2',
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (payload.errors) {
      const error = new Error(payload.errors.map((e) => e.message).join('; '));
      error.status = response.status;
      throw error;
    }
    if (!response.ok) {
      const error = new Error(`GraphQL request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return payload.data;
  } finally {
    clearTimeout(timer);
  }
}

function isAllowed(method, path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('..')) return false;
  return ALLOWLIST.some((entry) => entry.method === method && entry.regex.test(path));
}

// Parse an origin remote URL into owner/repo when hosted on GitHub.
// ssh:// URLs are accepted because the clone dialog allows that transport.
export function parseRemoteUrl(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url) return null;
  let match = url.match(/^(?:git@|ssh:\/\/(?:[^@/]+@)?)github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (!match) {
    match = url.match(/^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  }
  if (!match) return { url, isGithub: false };
  return { url, isGithub: true, owner: match[1], repo: match[2] };
}

export async function handleGithubRoute({ method, pathname, query, body, headers }) {
  if (pathname === '/api/remote' && method === 'GET') {
    const repo = typeof query.get('repo') === 'string' ? query.get('repo') : '';
    // Only registered repositories may be inspected, matching every other
    // repo-scoped route (arbitrary paths must not become a git oracle).
    const registered = await listRepos();
    if (!registered.includes(repo)) return fail(403, 'unknown or unregistered repo');
    try {
      const url = (await git(['remote', 'get-url', 'origin'], repo)).trim();
      return ok({ remote: parseRemoteUrl(url) });
    } catch (err) {
      return ok({ remote: null, detail: err.stderr || err.message });
    }
  }

  if (pathname === '/api/ready-for-review' && method === 'POST') {
    const pat = String(headers['x-github-pat'] || '').trim();
    if (!pat) return fail(401, 'missing GitHub token');
    const number = Number(body.number);
    const repoPath = typeof body.repo === 'string' ? body.repo : '';
    if (!Number.isInteger(number) || number < 1) return fail(400, 'invalid pull request number');
    const registered = await listRepos();
    if (!registered.includes(repoPath)) return fail(403, 'unknown or unregistered repo');
    try {
      const originUrl = (await git(['remote', 'get-url', 'origin'], repoPath)).trim();
      const remoteInfo = parseRemoteUrl(originUrl);
      if (!remoteInfo?.isGithub) return fail(400, 'origin remote is not hosted on GitHub');
      const lookup = `query($owner:String!, $name:String!, $number:Int!) {
        repository(owner:$owner, name:$name) {
          pullRequest(number:$number) { id isDraft }
        }
      }`;
      const lookupData = await githubGraphql(
        pat,
        lookup,
        { owner: remoteInfo.owner, name: remoteInfo.repo, number },
      );
      const pull = lookupData.repository?.pullRequest;
      if (!pull) return fail(404, 'pull request not found');
      if (!pull.isDraft) {
        return ok({ ready: true, changed: false });
      }
      const convert = `mutation($id:ID!) {
        markPullRequestReadyForReview(input:{ pullRequestId:$id }) {
          pullRequest { isDraft }
        }
      }`;
      const convertData = await githubGraphql(pat, convert, { id: pull.id });
      await appendAudit({ ok: true, action: 'ready-for-review', repo: repoPath, number });
      return ok({
        ready: true,
        changed: true,
        isDraft: convertData.markPullRequestReadyForReview.pullRequest.isDraft,
      });
    } catch (err) {
      await appendAudit({ ok: false, action: 'ready-for-review', repo: repoPath, number });
      return fail(err.status || 502, 'ready-for-review failed', err.message);
    }
  }

  if (pathname === '/api/merge-pull' && method === 'POST') {
    const pat = String(headers['x-github-pat'] || '').trim();
    if (!pat) return fail(401, 'missing GitHub token');
    const number = Number(body.number);
    const mergeMethodInput = String(body.mergeMethod || 'squash').toLowerCase();
    const repoPath = typeof body.repo === 'string' ? body.repo : '';
    if (!Number.isInteger(number) || number < 1) return fail(400, 'invalid pull request number');
    if (!['merge', 'squash', 'rebase'].includes(mergeMethodInput)) {
      return fail(400, 'invalid merge method');
    }
    const registered = await listRepos();
    if (!registered.includes(repoPath)) return fail(403, 'unknown or unregistered repo');
    try {
      const originUrl = (await git(['remote', 'get-url', 'origin'], repoPath)).trim();
      const remoteInfo = parseRemoteUrl(originUrl);
      if (!remoteInfo?.isGithub) return fail(400, 'origin remote is not hosted on GitHub');
      const lookup = `query($owner:String!, $name:String!, $number:Int!) {
        repository(owner:$owner, name:$name) {
          pullRequest(number:$number) { id state merged }
        }
      }`;
      const lookupData = await githubGraphql(
        pat,
        lookup,
        { owner: remoteInfo.owner, name: remoteInfo.repo, number },
      );
      const pull = lookupData.repository?.pullRequest;
      if (!pull) return fail(404, 'pull request not found');
      if (pull.state !== 'OPEN') {
        return ok({ merged: pull.merged, changed: false, state: pull.state });
      }
      const merge = `mutation($id:ID!, $method:PullRequestMergeMethod!) {
        mergePullRequest(input:{ pullRequestId:$id, mergeMethod:$method }) {
          pullRequest { merged state }
        }
      }`;
      const mergeData = await githubGraphql(
        pat,
        merge,
        { id: pull.id, method: mergeMethodInput.toUpperCase() },
      );
      const result = mergeData.mergePullRequest.pullRequest;
      await appendAudit({ ok: true, action: 'merge-pull', repo: repoPath, number, mergeMethod: mergeMethodInput });
      return ok({ merged: result.merged, changed: true, state: result.state });
    } catch (err) {
      await appendAudit({ ok: false, action: 'merge-pull', repo: repoPath, number });
      return fail(err.status || 502, 'merge failed', err.message);
    }
  }

  if (pathname !== '/api/github' || method !== 'POST') return null;

  const pat = String(headers['x-github-pat'] || '').trim();
  if (!pat) return fail(401, 'missing GitHub token');
  const ghMethod = typeof body.method === 'string' ? body.method.toUpperCase() : 'GET';
  const rawPath = typeof body.path === 'string' ? body.path.trim() : '';
  // Split the query string so the allowlist matches the path component only.
  const queryIndex = rawPath.indexOf('?');
  const ghPath = queryIndex === -1 ? rawPath : rawPath.slice(0, queryIndex);
  const ghQuery = queryIndex === -1 ? '' : rawPath.slice(queryIndex);
  if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(ghMethod)) {
    return fail(400, 'method not allowed');
  }
  if (!isAllowed(ghMethod, ghPath)) return fail(403, 'endpoint not in allowlist');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GITHUB_TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(`${GITHUB_API}${ghPath}${ghQuery}`, {
      method: ghMethod,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${pat}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'pr-helper-git2',
      },
      body: (ghMethod === 'GET' || ghMethod === 'DELETE')
        ? undefined
        : JSON.stringify(body.payload || {}),
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
  // Surface GitHub's own message ("Validation Failed", "Not Found") so error
  // toasts are actionable instead of a bare "HTTP 422".
  const upstreamError = upstream.ok
    ? null
    : (typeof data?.message === 'string' && data.message) || `GitHub request failed (${upstream.status})`;
  return {
    status: upstream.status,
    json: { status: upstream.status, data, ...(upstreamError ? { error: upstreamError } : {}) },
  };
}
