import fsp from 'node:fs/promises';
import path from 'node:path';
import { git } from './git.mjs';
import { fail, ok } from './http.mjs';
import { validateRefName } from './security.mjs';
import { appendAudit } from './store.mjs';
import { gitFail } from './routes-git-helpers.mjs';
import { parseWorktreeList } from './routes-git-read.mjs';

async function listWorktrees(repo) {
  const raw = await git(['worktree', 'list', '--porcelain'], repo);
  return parseWorktreeList(raw, repo);
}

function validPath(input) {
  if (typeof input !== 'string' || !input || /[\0\r\n]/.test(input)) return null;
  if (!path.isAbsolute(input)) return null;
  const resolved = path.resolve(input);
  if (resolved === path.parse(resolved).root) return null;
  return resolved;
}

async function realOrResolved(p) {
  const resolved = path.resolve(p);
  try {
    return await fsp.realpath(resolved);
  } catch {
    const parent = path.dirname(resolved);
    if (parent === resolved) return resolved;
    // Resolve existing ancestors so a symlinked parent (for example /tmp on
    // macOS) cannot hide that the target sits inside a repository.
    return path.join(await realOrResolved(parent), path.basename(resolved));
  }
}

async function findWorktree(repo, input) {
  const wanted = validPath(input);
  if (!wanted) return { error: fail(400, 'invalid worktree path') };
  const list = await listWorktrees(repo);
  const real = await fsp.realpath(wanted).catch(() => null);
  const entry = list.find((w) => w.path === wanted || (real && w.path === real));
  return entry ? { entry, list } : { error: fail(404, 'worktree is not registered') };
}

async function overlapsWorktreeRoots(target, roots) {
  const targetReal = await realOrResolved(target);
  for (const root of roots) {
    const rootReal = await realOrResolved(root);
    if (targetReal === rootReal || targetReal.startsWith(`${rootReal}${path.sep}`)) return true;
  }
  return false;
}

async function ensureEmptyDirectory(target) {
  let stat;
  try {
    stat = await fsp.lstat(target);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  if (stat.isSymbolicLink()) return 'worktree path must not be a symbolic link';
  if (!stat.isDirectory()) return 'worktree path exists and is not a directory';
  const entries = await fsp.readdir(target);
  if (entries.length) return 'worktree path is not empty';
  return null;
}

export async function handleGitWorktrees({ method, pathname, query, body, identity }, repo) {
  if (method !== 'POST') return null;
  if (pathname === '/api/worktrees/add') {
    const target = validPath(body.path);
    if (!target) return fail(400, 'worktree path must be absolute');
    const branch = validateRefName(body.branch);
    if (!branch) return fail(400, 'invalid branch name');
    const createBranch = body.createBranch === true;
    const list = await listWorktrees(repo);
    if (await overlapsWorktreeRoots(target, [repo])) {
      return fail(400, 'worktree path must be outside the repository');
    }
    if (await overlapsWorktreeRoots(target, list.map((w) => w.path))) {
      return fail(409, 'worktree path overlaps a registered worktree');
    }
    const problem = await ensureEmptyDirectory(target);
    if (problem) return fail(409, problem);
    const branchExists = await git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], repo)
      .then(() => true)
      .catch(() => false);
    if (createBranch && branchExists) return fail(409, `branch ${branch} already exists`);
    if (!createBranch && !branchExists) return fail(400, `branch ${branch} does not exist`);
    const argv = createBranch
      ? ['worktree', 'add', '-b', branch, target]
      : ['worktree', 'add', target, branch];
    try {
      await git(argv, repo);
    } catch (err) {
      await appendAudit({ ok: false, action: 'worktree-add', repo, path: target, branch, createBranch });
      return gitFail(err, 'worktree creation failed');
    }
    await appendAudit({ ok: true, action: 'worktree-add', repo, path: target, branch, createBranch });
    return ok({ ok: true, path: target, branch, createBranch, worktrees: await listWorktrees(repo) });
  }

  if (pathname === '/api/worktrees/remove') {
    const found = await findWorktree(repo, body.path);
    if (found.error) return found.error;
    const { entry } = found;
    if (entry.isMain) return fail(400, 'the main worktree cannot be removed');
    if (entry.current) return fail(400, 'the current worktree cannot be removed');
    if (entry.locked) return fail(409, 'worktree is locked; unlock it before removing');
    if (entry.prunable) return fail(409, 'worktree directory is missing; use prune instead');
    const force = body.force === true;
    if (force && body.confirm !== true) return fail(400, 'force removal requires confirm: true');
    if (!force) {
      let dirty;
      try {
        dirty = await git(['status', '--porcelain'], entry.path);
      } catch (err) {
        return gitFail(err, 'reading worktree status failed');
      }
      if (dirty.trim()) return fail(409, 'worktree has uncommitted changes; force removal requires confirm: true');
    }
    try {
      await git(['worktree', 'remove', ...(force ? ['--force'] : []), entry.path], repo);
    } catch (err) {
      await appendAudit({ ok: false, action: 'worktree-remove', repo, path: entry.path, force });
      return gitFail(err, 'worktree removal failed');
    }
    await appendAudit({ ok: true, action: 'worktree-remove', repo, path: entry.path, force });
    return ok({ ok: true, path: entry.path, worktrees: await listWorktrees(repo) });
  }

  if (pathname === '/api/worktrees/lock') {
    const found = await findWorktree(repo, body.path);
    if (found.error) return found.error;
    const { entry } = found;
    if (entry.isMain) return fail(400, 'the main worktree cannot be locked here');
    if (entry.locked) return fail(409, 'worktree is already locked');
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length > 200 || /[\0\r\n]/.test(reason)) return fail(400, 'invalid lock reason');
    const argv = ['worktree', 'lock', ...(reason ? ['--reason', reason] : []), entry.path];
    try {
      await git(argv, repo);
    } catch (err) {
      await appendAudit({ ok: false, action: 'worktree-lock', repo, path: entry.path });
      return gitFail(err, 'worktree lock failed');
    }
    await appendAudit({ ok: true, action: 'worktree-lock', repo, path: entry.path, reason });
    return ok({ ok: true, worktrees: await listWorktrees(repo) });
  }

  if (pathname === '/api/worktrees/unlock') {
    const found = await findWorktree(repo, body.path);
    if (found.error) return found.error;
    const { entry } = found;
    if (!entry.locked) return fail(409, 'worktree is not locked');
    try {
      await git(['worktree', 'unlock', entry.path], repo);
    } catch (err) {
      await appendAudit({ ok: false, action: 'worktree-unlock', repo, path: entry.path });
      return gitFail(err, 'worktree unlock failed');
    }
    await appendAudit({ ok: true, action: 'worktree-unlock', repo, path: entry.path });
    return ok({ ok: true, worktrees: await listWorktrees(repo) });
  }

  if (pathname === '/api/worktrees/prune') {
    if (body.confirm !== true) return fail(400, 'prune requires confirm: true');
    const before = await listWorktrees(repo);
    try {
      await git(['worktree', 'prune'], repo);
    } catch (err) {
      await appendAudit({ ok: false, action: 'worktree-prune', repo });
      return gitFail(err, 'worktree prune failed');
    }
    const after = await listWorktrees(repo);
    await appendAudit({ ok: true, action: 'worktree-prune', repo, removed: before.length - after.length });
    return ok({ ok: true, removed: before.length - after.length, worktrees: after });
  }

  return null;
}
