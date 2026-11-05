// Git API routes. Every handler returns { status, json } or null when the
// route does not match. Write actions use fixed argv arrays and are audited.
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  git,
  parseBlame,
  parseLog,
  parsePorcelainV2,
  parseRefs,
  parseReflog,
  parseTagObject,
} from './git.mjs';
import {
  isSensitivePath,
  normalizeRepoPath,
  resolveInside,
  validateCloneUrl,
  validateFolderName,
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
const FILE_MAX_BYTES = 1_000_000;

// Accept a commit SHA or an ordinary ref/branch/tag name (option-like and
// traversal values are rejected). Used to read a blob at a specific ref.
function validateRefSpec(raw) {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (!v || v.startsWith('-') || v.includes('..') || v.includes('\0')) return null;
  if (/^[0-9a-f]{7,40}$/.test(v)) return v;
  return validateRefName(v) ? v : null;
}

const ok = (json) => ({ status: 200, json });
const fail = (status, error, detail) => ({ status, json: { error, ...(detail ? { detail } : {}) } });

function gitFail(err, fallback) {
  return fail(400, fallback, err.stderr || err.message);
}

// Resolve a user-supplied parent directory and confirm it exists.
async function resolveParentDir(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const target = path.resolve(raw.trim());
  try {
    const real = await fsp.realpath(target);
    const stat = await fsp.stat(real);
    return stat.isDirectory() ? real : null;
  } catch {
    return null;
  }
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

  if (pathname === '/api/repos/clone' && method === 'POST') {
    const url = validateCloneUrl(body.url) ? body.url.trim() : null;
    const name = validateFolderName(body.name);
    if (!url) return fail(400, 'invalid or unsupported clone URL');
    if (!name) return fail(400, 'invalid destination folder name');
    const parent = await resolveParentDir(body.parentDir);
    if (!parent) return fail(400, 'parent directory does not exist');
    const target = path.join(parent, name);
    try {
      await fsp.stat(target);
      return fail(409, 'destination already exists');
    } catch { /* expected: target must not exist */ }
    try {
      await git(['clone', '--', url, target], process.cwd(), { timeout: 120_000 });
    } catch (err) {
      return gitFail(err, 'git clone failed');
    }
    const repos = await addRepo(target);
    ensureWatching(target);
    await appendAudit({ ok: true, action: 'repo-clone', repo: target, url });
    return ok({ repos, path: target });
  }

  if (pathname === '/api/repos/init' && method === 'POST') {
    if (typeof body.path !== 'string' || !body.path.trim()) {
      return fail(400, 'path must be a string');
    }
    const target = path.resolve(body.path.trim());
    if (target === path.parse(target).root) return fail(400, 'refusing to initialise a filesystem root');
    const parent = await resolveParentDir(path.dirname(target));
    if (!parent) return fail(400, 'parent directory does not exist');
    let exists = false;
    try {
      const stat = await fsp.stat(target);
      if (!stat.isDirectory()) return fail(400, 'path exists and is not a directory');
      exists = true;
      try {
        await fsp.stat(path.join(target, '.git'));
        return fail(409, 'already a git repository');
      } catch { /* no .git yet */ }
    } catch {
      await fsp.mkdir(target);
    }
    try {
      await git(['init'], target);
    } catch (err) {
      return gitFail(err, 'git init failed');
    }
    const repos = await addRepo(target);
    ensureWatching(target);
    await appendAudit({ ok: true, action: 'repo-init', repo: target, preExisting: exists });
    return ok({ repos, path: target });
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
    // scope=current follows only HEAD's history; default "all" keeps every
    // reachable ref so the graph shows branches and their merge points.
    const scope = String(query.get('scope') || 'all').toLowerCase() === 'current'
      ? 'current'
      : 'all';
    try {
      const raw = await git(
        [
          'log',
          ...(scope === 'current' ? [] : ['--all']),
          '--date-order',
          `--max-count=${limit}`,
          '--pretty=format:%H%x1f%P%x1f%an%x1f%ae%x1f%cI%x1f%s%x1f%b%x1e',
        ],
        repo,
      );
      return ok({ commits: parseLog(raw), scope });
    } catch (err) {
      return gitFail(err, 'git log failed');
    }
  }

  if (pathname === '/api/refs' && method === 'GET') {
    try {
      const raw = await git(
        ['for-each-ref', '--format=%(objectname)\t%(objecttype)\t%(refname)\t%(upstream)\t%(refname:short)\t%(upstream:track)'],
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

  if (pathname === '/api/file' && method === 'GET') {
    const rel = normalizeRepoPath(query.get('file'));
    if (!rel) return fail(400, 'invalid file path');
    if (isSensitivePath(rel)) {
      return ok({ masked: true, path: rel, binary: false, content: '', truncated: false, ref: null });
    }
    const refRaw = query.get('ref');
    const ref = refRaw ? validateRefSpec(refRaw) : null;
    if (refRaw && !ref) return fail(400, 'invalid ref');
    let content = '';
    let truncated = false;
    try {
      if (ref) {
        content = await git(['show', `${ref}:${rel}`], repo);
      } else {
        const resolved = await resolveInside(repo, rel);
        if (!resolved) return fail(403, 'path escapes repo root');
        const stat = await fsp.stat(resolved);
        if (!stat.isFile()) return fail(400, 'not a file');
        if (stat.size > FILE_MAX_BYTES) truncated = true;
        content = await fsp.readFile(resolved, 'utf8');
      }
    } catch (err) {
      return gitFail(err, ref ? 'git show failed' : 'file read failed');
    }
    if (content.length > FILE_MAX_BYTES) {
      content = content.slice(0, FILE_MAX_BYTES);
      truncated = true;
    }
    const binary = content.includes('\0');
    return ok({
      masked: false,
      path: rel,
      binary,
      content: binary ? '' : content,
      truncated,
      ref,
    });
  }

  if (pathname === '/api/blame' && method === 'GET') {
    const rel = normalizeRepoPath(query.get('file'));
    if (!rel) return fail(400, 'invalid file path');
    if (isSensitivePath(rel)) {
      return ok({ masked: true, path: rel, lines: [] });
    }
    const refRaw = query.get('ref');
    const ref = refRaw ? validateRefSpec(refRaw) : null;
    if (refRaw && !ref) return fail(400, 'invalid ref');
    const args = ['blame', '--porcelain'];
    if (ref) args.push(ref);
    args.push('--', rel);
    try {
      const lines = parseBlame(await git(args, repo));
      return ok({ masked: false, path: rel, lines });
    } catch (err) {
      return gitFail(err, 'git blame failed');
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

  if (pathname === '/api/remotes' && method === 'GET') {
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

  if (pathname === '/api/file-history' && method === 'GET') {
    const rel = normalizeRepoPath(query.get('file'));
    if (!rel) return fail(400, 'invalid file path');
    try {
      const raw = await git(
        [
          'log', '--follow', '--date-order',
          `--max-count=${LOG_LIMIT_MAX}`,
          '--pretty=format:%H%x1f%P%x1f%an%x1f%ae%x1f%cI%x1f%s%x1f%b%x1e',
          '--', rel,
        ],
        repo,
      );
      return ok({ path: rel, commits: parseLog(raw) });
    } catch (err) {
      return gitFail(err, 'git file history failed');
    }
  }

  if (pathname === '/api/stash-show' && method === 'GET') {
    const safe = validateStashIndex(query.get('index'));
    if (safe === null) return fail(400, 'invalid stash index');
    try {
      const diff = await git(['stash', 'show', '-p', `stash@{${safe}}`], repo);
      return ok({ index: safe, diff });
    } catch (err) {
      return gitFail(err, 'stash show failed');
    }
  }

  if (pathname === '/api/reflog' && method === 'GET') {
    try {
      const raw = await git(['reflog', `--max-count=${LOG_LIMIT_MAX}`], repo);
      return ok({ entries: parseReflog(raw) });
    } catch (err) {
      return gitFail(err, 'git reflog failed');
    }
  }

  if (pathname === '/api/tag-show' && method === 'GET') {
    const tagName = validateRefSpec(query.get('tag'));
    if (!tagName) return fail(400, 'invalid tag name');
    try {
      const type = (await git(['cat-file', '-t', tagName], repo)).trim();
      if (type !== 'tag') return fail(400, 'not an annotated tag');
      const raw = await git(['cat-file', '-p', tagName], repo);
      return ok({ tag: parseTagObject(raw) });
    } catch (err) {
      return gitFail(err, 'tag show failed');
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

  if (pathname === '/api/remote/add') {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(name) || name.startsWith('-')) {
      return fail(400, 'invalid remote name');
    }
    if (!validateCloneUrl(url)) return fail(400, 'invalid remote url');
    try {
      await git(['remote', 'add', name, url], repo);
      await appendAudit({ ok: true, action: 'remote-add', repo, name });
      return ok({ ok: true, name });
    } catch (err) {
      await appendAudit({ ok: false, action: 'remote-add', repo, name });
      return gitFail(err, 'git remote add failed');
    }
  }

  if (pathname === '/api/remote/remove') {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(name) || name.startsWith('-')) {
      return fail(400, 'invalid remote name');
    }
    try {
      await git(['remote', 'remove', name], repo);
      await appendAudit({ ok: true, action: 'remote-remove', repo, name });
      return ok({ ok: true, name });
    } catch (err) {
      await appendAudit({ ok: false, action: 'remote-remove', repo, name });
      return gitFail(err, 'git remote remove failed');
    }
  }

  if (pathname === '/api/remote/set-url') {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    const push = body.push === true;
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(name) || name.startsWith('-')) {
      return fail(400, 'invalid remote name');
    }
    if (!validateCloneUrl(url)) return fail(400, 'invalid remote url');
    const argv = push
      ? ['remote', 'set-url', '--push', name, url]
      : ['remote', 'set-url', name, url];
    try {
      await git(argv, repo);
      await appendAudit({ ok: true, action: 'remote-set-url', repo, name, push });
      return ok({ ok: true, name });
    } catch (err) {
      await appendAudit({ ok: false, action: 'remote-set-url', repo, name });
      return gitFail(err, 'git remote set-url failed');
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

  if (pathname === '/api/reset') {
    const mode = body.mode === 'soft' || body.mode === 'mixed' || body.mode === 'hard'
      ? body.mode
      : null;
    const sha = typeof body.sha === 'string' && /^[0-9a-f]{7,40}$/.test(body.sha.trim())
      ? body.sha.trim()
      : null;
    if (!mode) return fail(400, 'mode must be soft, mixed or hard');
    if (!sha) return fail(400, 'invalid commit sha');
    if (mode === 'hard' && body.confirm !== true) {
      return fail(400, 'hard reset requires confirm: true');
    }
    try {
      await git(['reset', `--${mode}`, sha], repo);
    } catch (err) {
      await appendAudit({ ok: false, action: 'reset', repo, mode, sha });
      return gitFail(err, `git reset --${mode} failed`);
    }
    await appendAudit({ ok: true, action: 'reset', repo, mode, sha });
    return ok({ ok: true, mode, sha });
  }

  if (pathname === '/api/revert') {
    const sha = typeof body.sha === 'string' && /^[0-9a-f]{7,40}$/.test(body.sha.trim())
      ? body.sha.trim()
      : null;
    if (!sha) return fail(400, 'invalid commit sha');
    try {
      // Reject merge commits explicitly: reverting one needs an explicit
      // mainline parent (-m), which is intentionally not supported here.
      const parents = (await git(['rev-list', '--parents', '-n', '1', sha], repo))
        .trim()
        .split(/\s+/);
      if (parents.length > 2) {
        return fail(400, 'cannot revert a merge commit', 'merge commits need an explicit mainline parent (-m)');
      }
      const result = await git(['revert', '--no-edit', sha], repo);
      await appendAudit({ ok: true, action: 'revert', repo, sha });
      return ok({ ok: true, reverted: sha, result: result.trim() });
    } catch (err) {
      // A conflicting revert leaves the repository in a "reverting" state.
      // Abort it so the caller is returned to a clean working tree.
      try {
        await git(['revert', '--abort'], repo);
      } catch {
        // No revert was in progress (e.g. the failure happened earlier).
      }
      await appendAudit({ ok: false, action: 'revert', repo, sha });
      return gitFail(err, 'git revert failed');
    }
  }

  if (pathname === '/api/ignore') {
    const target = normalizeRepoPath(typeof body.file === 'string' ? body.file : '');
    if (!target) return fail(400, 'invalid file path');
    const ignorePath = path.join(repo, '.gitignore');
    try {
      let current = '';
      try {
        current = await fsp.readFile(ignorePath, 'utf8');
      } catch {
        current = '';
      }
      const present = current.split('\n').some((l) => l.trim() === target);
      if (present) return ok({ ok: true, ignored: target, added: false });
      let next = current;
      if (current.length && !current.endsWith('\n')) next += '\n';
      next += `${target}\n`;
      await fsp.writeFile(ignorePath, next, 'utf8');
      await appendAudit({ ok: true, action: 'ignore', repo, file: target });
      return ok({ ok: true, ignored: target, added: true });
    } catch (err) {
      await appendAudit({ ok: false, action: 'ignore', repo, file: target });
      return fail(400, 'failed to update .gitignore', err.message);
    }
  }

  if (pathname === '/api/clean') {
    // Never pass -x/-X: ignored files (e.g. .env, keys) must stay untouched.
    if (body.dryRun === true) {
      try {
        const out = await git(['clean', '-nd'], repo);
        const paths = out.split('\n')
          .filter((l) => l.startsWith('Would remove '))
          .map((l) => l.slice('Would remove '.length));
        return ok({ dryRun: true, paths });
      } catch (err) {
        return gitFail(err, 'git clean dry-run failed');
      }
    }
    if (body.confirm !== true) return fail(400, 'clean requires confirmation');
    try {
      const out = await git(['clean', '-fd'], repo);
      await appendAudit({ ok: true, action: 'clean', repo });
      const removed = out.split('\n')
        .filter((l) => l.startsWith('Removing '))
        .map((l) => l.slice('Removing '.length));
      return ok({ dryRun: false, removed });
    } catch (err) {
      await appendAudit({ ok: false, action: 'clean', repo });
      return gitFail(err, 'git clean failed');
    }
  }

  if (pathname === '/api/tag/push') {
    const name = validateRefName(typeof body.name === 'string' ? body.name : '');
    const remoteName = typeof body.remote === 'string' && body.remote.trim()
      ? body.remote.trim()
      : 'origin';
    if (!name) return fail(400, 'invalid tag name');
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(remoteName)) return fail(400, 'invalid remote name');
    try {
      const result = await git(['push', remoteName, name], repo);
      await appendAudit({ ok: true, action: 'tag-push', repo, tag: name, remote: remoteName });
      return ok({ ok: true, pushed: name, remote: remoteName, result: result.trim() });
    } catch ( err) {
      await appendAudit({ ok: false, action: 'tag-push', repo, tag: name, remote: remoteName });
      return gitFail(err, 'git push tag failed');
    }
  }

  if (pathname === '/api/fetch') {
    const remote = typeof body.remote === 'string' && body.remote.trim() ? body.remote.trim() : null;
    if (remote && !/^[A-Za-z0-9._-]{1,64}$/.test(remote)) return fail(400, 'invalid remote name');
    const prune = body.prune === true;
    try {
      const argv = remote ? ['fetch', '--', remote] : ['fetch', '--all'];
      if (prune) argv.splice(1, 0, '--prune');
      await git(argv, repo);
    } catch (err) {
      return gitFail(err, 'git fetch failed');
    }
    await appendAudit({ ok: true, action: 'fetch', repo, prune });
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
    const includeUntracked = body.includeUntracked === true;
    const argv = ['stash', 'push'];
    if (includeUntracked) argv.push('-u');
    if (message) argv.push('-m', message);
    try {
      await git(argv, repo);
    } catch (err) {
      return gitFail(err, 'git stash failed');
    }
    await appendAudit({ ok: true, action: 'stash-create', repo, includeUntracked });
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
