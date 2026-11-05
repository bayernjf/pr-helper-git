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
import { ensureWatching, stopWatching } from './watcher.mjs';

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
    ensureWatching(target);
    return ok({ repos });
  }

  if (pathname === '/api/repos/remove' && method === 'POST') {
    const target = typeof body.repo === 'string' ? body.repo : null;
    const repos = await removeRepo(target);
    stopWatching(target);
    await appendAudit({ action: 'repo-remove', repo: target });
    return ok({ repos });
  }

  // GitHub-specific endpoints are handled by routes-github.mjs and do not
  // carry a repo field the same way; let them fall through before the
  // generic registered-repo guard below.
  if (pathname === '/api/github' || pathname === '/api/remote') return null;

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

  if (pathname === '/api/commit-files' && method === 'GET') {
    const sha = typeof query.get('sha') === 'string' ? query.get('sha').trim() : '';
    if (!/^[0-9a-f]{7,40}$/.test(sha)) return fail(400, 'invalid commit sha');
    try {
      // Merge commits emit nothing under plain diff-tree; compare against
      // the first parent so the files the merge brought in are still listed.
      let isMerge = false;
      try {
        await git(['rev-parse', '--verify', `${sha}^2`], repo);
        isMerge = true;
      } catch {
        isMerge = false;
      }
      const firstParent = isMerge
        ? (await git(['rev-parse', `${sha}^1`], repo)).trim()
        : null;
      const [nameStatus, numstat] = isMerge
        ? await Promise.all([
            git(['diff', '--name-status', '-M', firstParent, sha], repo),
            git(['diff', '--numstat', '-M', firstParent, sha], repo),
          ])
        : await Promise.all([
            git(['diff-tree', '--no-commit-id', '--name-status', '-r', '-M', sha], repo),
            git(['diff-tree', '--no-commit-id', '--numstat', '-r', '-M', sha], repo),
          ]);
      const stats = new Map();
      for (const line of numstat.split('\n')) {
        if (!line) continue;
        const parts = line.split('\t');
        const target = parts[parts.length - 1];
        stats.set(target, {
          additions: Number(parts[0]) || 0,
          deletions: Number(parts[1]) || 0,
        });
      }
      const files = [];
      for (const line of nameStatus.split('\n')) {
        if (!line) continue;
        const parts = line.split('\t');
        const status = parts[0];
        const isRename = status.startsWith('R') || status.startsWith('C');
        const path = isRename ? parts[2] : parts[1];
        const s = stats.get(path) || { additions: 0, deletions: 0 };
        files.push({
          status,
          path,
          renamedFrom: isRename ? parts[1] : null,
          additions: s.additions,
          deletions: s.deletions,
        });
      }
      return ok({ files });
    } catch (err) {
      return gitFail(err, 'commit file listing failed');
    }
  }

  if (pathname === '/api/commit-diff' && method === 'GET') {
    const shaRaw = query.get('sha') || '';
    const file = normalizeRepoPath(query.get('file') || '');
    if (!/^[0-9a-f]{7,40}$/.test(shaRaw) || !file) return fail(400, 'invalid parameters');
    const resolved = await resolveInside(repo, file);
    if (!resolved) return fail(403, 'path escapes repo root');
    try {
      const diff = await git(['show', '--format=', shaRaw, '--', file], repo);
      return ok({ masked: false, path: file, diff, truncated: false });
    } catch (err) {
      return gitFail(err, 'commit diff failed');
    }
  }

  if (pathname === '/api/stash-list' && method === 'GET') {
    try {
      const raw = await git(['stash', 'list', '--format=%gd\t%gs'], repo);
      const entries = raw
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [selector, subject] = line.split('\t');
          const m = selector.match(/stash@\{(\d+)\}/);
          return { index: m ? Number(m[1]) : 0, selector, subject };
        });
      return ok({ entries });
    } catch (err) {
      return gitFail(err, 'stash list failed');
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

  if (pathname === '/api/branch/rename') {
    const name = validateRefName(body.name);
    const newName = validateRefName(body.newName);
    if (!name || !newName) return fail(400, 'invalid branch name');
    try {
      await git(['branch', '-m', name, newName], repo);
    } catch (err) {
      return gitFail(err, 'branch rename failed');
    }
    await appendAudit({ ok: true, action: 'branch-rename', repo, from: name, to: newName });
    return ok({ ok: true, branch: newName });
  }

  if (pathname === '/api/tag/create') {
    const name = validateRefName(body.name);
    if (!name) return fail(400, 'invalid tag name');
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (message.length > 300) return fail(400, 'tag message too long');
    const argv = message ? ['tag', '-a', name, '-m', message] : ['tag', name];
    if (body.from) {
      const from = validateRefName(body.from);
      if (!from) return fail(400, 'invalid start ref');
      argv.push(from);
    }
    try {
      await git(argv, repo);
    } catch (err) {
      return gitFail(err, 'tag creation failed');
    }
    await appendAudit({ ok: true, action: 'tag-create', repo, tag: name, annotated: !!message });
    return ok({ ok: true, tag: name });
  }

  if (pathname === '/api/tag/delete') {
    const name = validateRefName(body.name);
    if (!name) return fail(400, 'invalid tag name');
    try {
      await git(['tag', '-d', name], repo);
    } catch (err) {
      return gitFail(err, 'tag deletion failed');
    }
    await appendAudit({ ok: true, action: 'tag-delete', repo, tag: name });
    return ok({ ok: true, tag: name });
  }

  if (pathname === '/api/branch/push') {
    const name = validateRefName(body.name);
    if (!name) return fail(400, 'invalid branch name');
    const remoteName = typeof body.remote === 'string' && body.remote.trim()
      ? body.remote.trim()
      : 'origin';
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(remoteName)) return fail(400, 'invalid remote name');
    try {
      await git(['push', '-u', remoteName, name], repo);
    } catch (err) {
      return gitFail(err, 'branch push failed');
    }
    await appendAudit({ ok: true, action: 'branch-push', repo, remote: remoteName, branch: name });
    return ok({ ok: true, branch: name });
  }

  if (pathname === '/api/branch/delete-remote') {
    const name = validateRefName(body.name);
    if (!name) return fail(400, 'invalid branch name');
    const remoteName = typeof body.remote === 'string' && body.remote.trim()
      ? body.remote.trim()
      : 'origin';
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(remoteName)) return fail(400, 'invalid remote name');
    try {
      await git(['push', remoteName, '--delete', name], repo);
    } catch (err) {
      return gitFail(err, 'remote branch deletion failed');
    }
    await appendAudit({ ok: true, action: 'branch-delete-remote', repo, remote: remoteName, branch: name });
    return ok({ ok: true, branch: name });
  }

  if (pathname === '/api/amend') {
    const message = typeof body.message === 'string' ? body.message.replace(/\r\n/g, '\n').trim() : '';
    if (!message) return fail(400, 'amend message must not be empty');
    if (message.length > 500 || message.startsWith('-') || message.includes('\0')) {
      return fail(400, 'invalid amend message');
    }
    try {
      await git(['commit', '--amend', '-F', '-'], repo, { input: `${message}\n` });
      const sha = (await git(['rev-parse', 'HEAD'], repo)).trim();
      await appendAudit({ ok: true, action: 'amend', repo, commit: sha });
      return ok({ ok: true, commit: sha });
    } catch (err) {
      return gitFail(err, 'amend failed');
    }
  }

  if (pathname === '/api/remotes') {
    try {
      const raw = await git(['remote', '-v'], repo);
      const remotes = [];
      for (const line of raw.split('\n')) {
        const m = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
        if (!m) continue;
        const existing = remotes.find((r) => r.name === m[1]);
        if (existing) existing[m[3]] = m[2];
        else remotes.push({ name: m[1], fetch: m[3] === 'fetch' ? m[2] : null, push: m[3] === 'push' ? m[2] : null });
      }
      return ok({ remotes });
    } catch (err) {
      return gitFail(err, 'git remote failed');
    }
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
