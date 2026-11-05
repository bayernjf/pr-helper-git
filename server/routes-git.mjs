// Git API routes. Every handler returns { status, json } or null when the
// route does not match. Write actions use fixed argv arrays and are audited.
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  git,
  parseLog,
  parsePorcelainV2,
  parseRefs,
} from './git.mjs';
import {
  isSensitivePath,
  normalizeRepoPath,
  resolveInside,
  validateRefName,
} from './security.mjs';
import {
  addRepo,
  appendAudit,
  listRepos,
  removeRepo,
} from './store.mjs';

const DIFF_LINE_LIMIT = 2000;
const LOG_LIMIT_DEFAULT = 200;
const LOG_LIMIT_MAX = 1000;

const ok = (json) => ({ status: 200, json });
const fail = (status, error, detail) => ({ status, json: { error, ...(detail ? { detail } : {}) } });

function gitFail(err, fallback) {
  return fail(400, fallback, err.stderr || err.message);
}

async function findRegistered(repoArg) {
  if (typeof repoArg !== 'string' || !repoArg) return null;
  const repos = await listRepos();
  if (!repos.includes(repoArg)) return null;
  try {
    const real = await fsp.realpath(repoArg);
    return repos.includes(real) ? real : repoArg;
  } catch {
    return repoArg;
  }
}

async function repoBrief(absPath) {
  const brief = {
    path: absPath,
    name: path.basename(absPath),
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    lastCommit: null,
    error: null,
  };
  try {
    const status = parsePorcelainV2(await git(['status', '--porcelain=v2', '--branch'], absPath));
    brief.branch = status.branch;
    brief.upstream = status.upstream;
    brief.ahead = status.ahead;
    brief.behind = status.behind;
    for (const f of status.files) {
      if (f.area === 'staged') brief.staged += 1;
      else if (f.area === 'unstaged' || f.area === 'unmerged') brief.unstaged += 1;
      else brief.untracked += 1;
    }
    try {
      const last = await git(['log', '-1', '--format=%cI%n%s'], absPath);
      const [at, ...rest] = last.split('\n');
      brief.lastCommit = { at: at || null, subject: rest.join('\n').trim() || null };
    } catch { /* no commits yet */ }
  } catch (err) {
    brief.error = err.stderr || err.message;
  }
  return brief;
}

function validateStashIndex(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 99 ? n : null;
}

export async function handleGitRoute({ method, pathname, query, body }) {
  if (pathname === '/api/health' && method === 'GET') {
    return ok({ ok: true });
  }

  // ---------- repository registry ----------

  if (pathname === '/api/repos' && method === 'GET') {
    const repos = await listRepos();
    const briefs = await Promise.all(repos.map(repoBrief));
    return ok({ collectedAt: new Date().toISOString(), repos: briefs });
  }

  if (pathname === '/api/repos/add' && method === 'POST') {
    const target = typeof body.repo === 'string' ? path.resolve(body.repo) : null;
    if (!target) return fail(400, 'repo must be a string path');
    try {
      await fsp.stat(path.join(target, '.git'));
    } catch {
      return fail(400, 'not a git repository (missing .git)');
    }
    const repos = await addRepo(target);
    await appendAudit({ action: 'repo-add', repo: target });
    return ok({ repos });
  }

  if (pathname === '/api/repos/remove' && method === 'POST') {
    const target = typeof body.repo === 'string' ? body.repo : null;
    const repos = await removeRepo(target);
    await appendAudit({ action: 'repo-remove', repo: target });
    return ok({ repos });
  }

  // All remaining routes operate on a registered repo.
  const repo = await findRegistered(method === 'GET' ? query.get('repo') : body.repo);
  if (!repo) return fail(403, 'unknown or unregistered repo');

  // ---------- reads ----------

  if (pathname === '/api/status' && method === 'GET') {
    try {
      const raw = await git(['status', '--porcelain=v2', '--branch'], repo);
      const status = parsePorcelainV2(raw);
      return ok({ collectedAt: new Date().toISOString(), repo, status });
    } catch (err) {
      return gitFail(err, 'git status failed');
    }
  }

  if (pathname === '/api/log' && method === 'GET') {
    let limit = Number(query.get('limit')) || LOG_LIMIT_DEFAULT;
    if (!Number.isInteger(limit) || limit <= 0) limit = LOG_LIMIT_DEFAULT;
    limit = Math.min(limit, LOG_LIMIT_MAX);
    try {
      const raw = await git(
        [
          'log',
          '--all',
          '--date-order',
          `--max-count=${limit}`,
          '--pretty=format:%H%x1f%P%x1f%an%x1f%ae%x1f%cI%x1f%s%x1f%b%x1e',
        ],
        repo,
      );
      return ok({ commits: parseLog(raw) });
    } catch (err) {
      return gitFail(err, 'git log failed');
    }
  }

  if (pathname === '/api/refs' && method === 'GET') {
    try {
      const raw = await git(
        ['for-each-ref', '--format=%(objectname)\t%(objecttype)\t%(refname)\t%(upstream)\t%(refname:short)'],
        repo,
      );
      return ok({ refs: parseRefs(raw) });
    } catch (err) {
      return gitFail(err, 'git for-each-ref failed');
    }
  }

  if (pathname === '/api/diff' && method === 'GET') {
    const rel = normalizeRepoPath(query.get('file'));
    if (!rel) return fail(400, 'invalid file path');
    const resolved = await resolveInside(repo, rel);
    if (!resolved) return fail(403, 'path escapes repo root');
    if (isSensitivePath(rel)) {
      return ok({ masked: true, path: rel, diff: '', truncated: false });
    }
    const staged = query.get('staged') === '1';
    const args = ['diff'];
    if (staged) args.push('--cached');
    args.push('--', rel);
    try {
      let diff = await git(args, repo);
      let truncated = false;
      const lines = diff.split('\n');
      if (lines.length > DIFF_LINE_LIMIT) {
        diff = lines.slice(0, DIFF_LINE_LIMIT).join('\n');
        truncated = true;
      }
      return ok({ masked: false, path: rel, diff, truncated });
    } catch (err) {
      return gitFail(err, 'git diff failed');
    }
  }

  if (pathname === '/api/commit' && method === 'GET') {
    const sha = typeof query.get('sha') === 'string' ? query.get('sha').trim() : '';
    if (!/^[0-9a-f]{7,40}$/.test(sha)) return fail(400, 'invalid commit sha');
    try {
      const detail = await git(['show', '--stat', '--format=fuller', sha], repo);
      return ok({ sha, detail });
    } catch (err) {
      return gitFail(err, 'git show failed');
    }
  }

  if (method !== 'POST') return null;

  // ---------- writes ----------

  if (pathname === '/api/stage') {
    const action = body.action === 'unstage' ? 'unstage' : body.action === 'stage' ? 'stage' : null;
    if (!action) return fail(400, 'action must be "stage" or "unstage"');
    const rel = normalizeRepoPath(body.file);
    if (!rel) return fail(400, 'invalid file path');
    const resolved = await resolveInside(repo, rel);
    if (!resolved) return fail(403, 'path escapes repo root');
    const argv = action === 'stage'
      ? ['add', '--', rel]
      : ['restore', '--staged', '--', rel];
    try {
      await git(argv, repo);
    } catch (err) {
      await appendAudit({ ok: false, action, repo, file: rel });
      return gitFail(err, `git ${action} failed`);
    }
    await appendAudit({ ok: true, action, repo, file: rel });
    return ok({ ok: true, action, file: rel });
  }

  if (pathname === '/api/stage-all') {
    const action = body.action === 'unstage' ? 'unstage' : 'stage';
    const argv = action === 'stage' ? ['add', '--all'] : ['restore', '--staged', '.'];
    try {
      await git(argv, repo);
    } catch (err) {
      return gitFail(err, `git ${action} all failed`);
    }
    await appendAudit({ ok: true, action: `${action}-all`, repo });
    return ok({ ok: true, action });
  }

  if (pathname === '/api/commit') {
    const message = typeof body.message === 'string' ? body.message.replace(/\r\n/g, '\n').trim() : '';
    if (!message) return fail(400, 'commit message must not be empty');
    if (message.length > 500) return fail(400, 'commit message must be at most 500 characters');
    if (message.startsWith('-') || message.includes('\0')) return fail(400, 'invalid commit message');
    try {
      const staged = await git(['diff', '--cached', '--name-only'], repo);
      if (!staged.trim()) return fail(409, 'nothing staged to commit');
      await git(['commit', '-F', '-'], repo, { input: `${message}\n` });
      const sha = (await git(['rev-parse', 'HEAD'], repo)).trim();
      await appendAudit({ ok: true, action: 'commit', repo, commit: sha });
      return ok({ ok: true, commit: sha });
    } catch (err) {
      await appendAudit({ ok: false, action: 'commit', repo });
      return gitFail(err, 'git commit failed');
    }
  }

  if (pathname === '/api/discard') {
    if (body.confirm !== true) return fail(400, 'discard requires confirm: true');
    const rel = normalizeRepoPath(body.file);
    if (!rel) return fail(400, 'invalid file path');
    if (isSensitivePath(rel)) return fail(403, 'sensitive files cannot be discarded here');
    const resolved = await resolveInside(repo, rel);
    if (!resolved) return fail(403, 'path escapes repo root');
    try {
      await git(['ls-files', '--error-unmatch', '--', rel], repo);
    } catch {
      return fail(400, 'refusing to discard an untracked file');
    }
    try {
      await git(['restore', '--', rel], repo);
    } catch (err) {
      return gitFail(err, 'git restore failed');
    }
    await appendAudit({ ok: true, action: 'discard', repo, file: rel });
    return ok({ ok: true, file: rel });
  }

  if (pathname === '/api/checkout') {
    const ref = validateRefName(body.ref);
    if (!ref) return fail(400, 'invalid ref name');
    try {
      // No "--" separator: validated refs such as "origin/feature" rely on
      // git's DWIM behaviour to create a local tracking branch.
      await git(['checkout', ref], repo);
    } catch (err) {
      return gitFail(err, 'git checkout failed');
    }
    await appendAudit({ ok: true, action: 'checkout', repo, ref });
    return ok({ ok: true, ref });
  }

  if (pathname === '/api/branch/create') {
    const name = validateRefName(body.name);
    if (!name) return fail(400, 'invalid branch name');
    const argv = ['checkout', '-b', name];
    if (body.from) {
      const from = validateRefName(body.from);
      if (!from) return fail(400, 'invalid start ref');
      argv.push('--', from);
    }
    try {
      await git(argv, repo);
    } catch (err) {
      return gitFail(err, 'branch creation failed');
    }
    await appendAudit({ ok: true, action: 'branch-create', repo, branch: name });
    return ok({ ok: true, branch: name });
  }

  if (pathname === '/api/branch/delete') {
    const name = validateRefName(body.name);
    if (!name) return fail(400, 'invalid branch name');
    try {
      await git(['branch', body.force ? '-D' : '-d', '--', name], repo);
    } catch (err) {
      return gitFail(err, 'branch deletion failed');
    }
    await appendAudit({ ok: true, action: 'branch-delete', repo, branch: name });
    return ok({ ok: true, branch: name });
  }

  if (pathname === '/api/merge') {
    const ref = validateRefName(body.ref);
    if (!ref) return fail(400, 'invalid ref name');
    try {
      const result = await git(['merge', '--no-edit', '--', ref], repo);
      await appendAudit({ ok: true, action: 'merge', repo, ref });
      return ok({ ok: true, ref, result: result.trim() });
    } catch (err) {
      await appendAudit({ ok: false, action: 'merge', repo, ref });
      return gitFail(err, 'git merge failed (resolve conflicts before continuing)');
    }
  }

  if (pathname === '/api/fetch') {
    const remote = typeof body.remote === 'string' && body.remote.trim() ? body.remote.trim() : null;
    if (remote && !/^[A-Za-z0-9._-]{1,64}$/.test(remote)) return fail(400, 'invalid remote name');
    try {
      await git(remote ? ['fetch', '--', remote] : ['fetch', '--all'], repo);
    } catch (err) {
      return gitFail(err, 'git fetch failed');
    }
    await appendAudit({ ok: true, action: 'fetch', repo });
    return ok({ ok: true });
  }

  if (pathname === '/api/pull') {
    try {
      const result = await git(['pull', '--no-edit'], repo);
      await appendAudit({ ok: true, action: 'pull', repo });
      return ok({ ok: true, result: result.trim() });
    } catch (err) {
      return gitFail(err, 'git pull failed');
    }
  }

  if (pathname === '/api/push') {
    try {
      let argv = ['push'];
      if (body.setUpstream) {
        const status = parsePorcelainV2(await git(['status', '--porcelain=v2', '--branch'], repo));
        if (!status.branch) return fail(400, 'detached HEAD cannot be pushed with upstream');
        argv = ['push', '-u', 'origin', status.branch];
      }
      const result = await git(argv, repo);
      await appendAudit({ ok: true, action: 'push', repo });
      return ok({ ok: true, result: result.trim() });
    } catch (err) {
      return gitFail(err, 'git push failed');
    }
  }

  if (pathname === '/api/stash/create') {
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (message.length > 200) return fail(400, 'stash message too long');
    const argv = ['stash', 'push'];
    if (message) argv.push('-m', message);
    try {
      await git(argv, repo);
    } catch (err) {
      return gitFail(err, 'git stash failed');
    }
    await appendAudit({ ok: true, action: 'stash-create', repo });
    return ok({ ok: true });
  }

  if (pathname === '/api/stash/apply') {
    const index = validateStashIndex(body.index);
    if (index === null) return fail(400, 'invalid stash index');
    const refName = `stash@{${index}}`;
    try {
      await git(['stash', body.drop ? 'pop' : 'apply', refName], repo);
    } catch (err) {
      return gitFail(err, 'stash apply failed');
    }
    await appendAudit({ ok: true, action: 'stash-apply', repo, index, drop: !!body.drop });
    return ok({ ok: true, index });
  }

  if (pathname === '/api/stash/drop') {
    const index = validateStashIndex(body.index);
    if (index === null) return fail(400, 'invalid stash index');
    try {
      await git(['stash', 'drop', `stash@{${index}}`], repo);
    } catch (err) {
      return gitFail(err, 'stash drop failed');
    }
    await appendAudit({ ok: true, action: 'stash-drop', repo, index });
    return ok({ ok: true, index });
  }

  return null;
}
