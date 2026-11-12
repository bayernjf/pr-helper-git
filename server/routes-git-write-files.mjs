import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { git }from './git.mjs'
import { fail, ok } from './http.mjs';
import { isSensitivePath, normalizeRepoPath, resolveInside }from './security.mjs'
import { appendAudit }from './store.mjs'
import { SAVE_MAX_BYTES, gitFail, sensitiveFail, unmergedPaths }from './routes-git-helpers.mjs'

export async function handleGitWriteFiles({ method, pathname, query, body, identity }, repo) {
  if (pathname === '/api/conflict/resolve') {
    const rel = normalizeRepoPath(body.path);
    const strategy = body.strategy;
    if (!rel || (strategy !== 'ours' && strategy !== 'theirs' && strategy !== 'mark')) {
      return fail(400, 'invalid parameters');
    }
    const resolved = await resolveInside(repo, rel);
    if (!resolved) return fail(403, 'path escapes repo root');
    let unmerged = '';
    try {
      unmerged = await git(['diff', '--name-only', '--diff-filter=U', '--', rel], repo);
    } catch { /* treated as not conflicted */ }
    if (!unmerged.trim()) return fail(400, 'not a conflicted file', rel);
    try {
      if (strategy !== 'mark') {
        await git(['checkout', `--${strategy}`, '--', rel], repo);
      }
      // -A also stages a deletion (e.g. "theirs deleted it").
      await git(['add', '-A', '--', rel], repo);
      const remaining = await unmergedPaths(repo);
      await appendAudit({ ok: true, action: 'conflict-resolve', repo, path: rel, strategy });
      return ok({ ok: true, path: rel, strategy, remaining });
    } catch (err) {
      await appendAudit({ ok: false, action: 'conflict-resolve', repo, path: rel, strategy });
      return gitFail(err, 'conflict resolution failed');
    }
  }

  if (pathname === '/api/ignore') {
    const target = normalizeRepoPath(typeof body.file === 'string' ? body.file : '');
    if (!target) return fail(400, 'invalid file path');
    // Resolve through symlinks so a .gitignore that links outside the repo
    // cannot be rewritten (and cannot escape the repository root).
    const ignorePath = await resolveInside(repo, '.gitignore');
    if (!ignorePath) return fail(403, 'path escapes repo root');
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

  if (pathname === '/api/mv') {
    const from = normalizeRepoPath(typeof body.from === 'string' ? body.from : '');
    const to = normalizeRepoPath(typeof body.to === 'string' ? body.to : '');
    if (!from || !to) return fail(400, 'invalid source or destination path');
    if (from === to) return fail(400, 'destination equals source');
    if (isSensitivePath(from) || isSensitivePath(to)) {
      return fail(403, 'sensitive files cannot be moved from the UI');
    }
    try {
      // "--" terminates options so a repository file whose name starts with
      // "-" is treated as a path, never as a git flag.
      await git(['mv', '--', from, to], repo);
      await appendAudit({ ok: true, action: 'mv', repo, from, to });
      return ok({ ok: true, from, to });
    } catch (err) {
      await appendAudit({ ok: false, action: 'mv', repo, from, to });
      return gitFail(err, 'git mv failed');
    }
  }

  if (pathname === '/api/rm') {
    const target = normalizeRepoPath(typeof body.file === 'string' ? body.file : '');
    if (!target) return fail(400, 'invalid file path');
    if (isSensitivePath(target)) return fail(403, 'sensitive files cannot be removed from the UI');
    const force = body.force === true;
    try {
      // git rm only works on tracked files. A fully untracked file is removed
      // directly after resolving it inside the repository root.
      const tracked = (await git(['ls-files', '--', target], repo)).trim();
      if (tracked) {
        await git(['rm', ...(force ? ['-f'] : []), '--', target], repo);
        await appendAudit({ ok: true, action: 'rm', repo, file: target, force, method: 'git' });
        return ok({ ok: true, file: target, force, method: 'git' });
      }
      const abs = await resolveInside(repo, target);
      if (!abs) return fail(400, 'invalid file path');
      await fsp.unlink(abs);
      await appendAudit({ ok: true, action: 'rm', repo, file: target, method: 'unlink' });
      return ok({ ok: true, file: target, method: 'unlink' });
    } catch (err) {
      await appendAudit({ ok: false, action: 'rm', repo, file: target, force });
      return gitFail(err, 'git rm failed');
    }
  }

  if (pathname === '/api/save') {
    const target = normalizeRepoPath(typeof body.file === 'string' ? body.file : '');
    if (!target) return fail(400, 'invalid file path');
    // Sensitive files are masked everywhere; refuse to edit them here too.
    if (isSensitivePath(target)) return fail(403, 'sensitive files cannot be edited');
    if (typeof body.content !== 'string') return fail(400, 'missing file content');
    if (body.content.includes('\0')) return fail(400, 'content contains NUL byte');
    const bytes = Buffer.byteLength(body.content, 'utf8');
    if (bytes > SAVE_MAX_BYTES) return fail(400, 'file exceeds the 1 MB save limit');
    // Optional optimistic-concurrency guard. When the client supplies the
    // mtime it observed on load, a mismatch means the file changed on disk
    // (or was deleted) and the save is rejected so the change is not lost.
    const hasExpected = typeof body.expectedMtime === 'number' && Number.isFinite(body.expectedMtime);
    try {
      const abs = await resolveInside(repo, target);
      if (!abs) return fail(400, 'invalid file path');
      const stat = await fsp.stat(abs).catch(() => null);
      if (stat && stat.isDirectory()) return fail(400, 'target path is a directory');
      if (hasExpected) {
        if (!stat || stat.mtimeMs !== body.expectedMtime) {
          await appendAudit({ ok: false, action: 'save', repo, file: target, reason: 'stale' });
          return fail(409, 'file changed on disk; reload before saving');
        }
      }
      // Atomic replacement: write a sibling temp file, then rename over it.
      // Ensure the parent directory exists so a new file can use a nested
      // path (mkdir is a no-op for an existing directory, e.g. edits).
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      const tmp = `${abs}.tmp-${process.pid}`;
      await fsp.writeFile(tmp, body.content, 'utf8');
      await fsp.rename(tmp, abs);
      const newStat = await fsp.stat(abs);
      await appendAudit({ ok: true, action: 'save', repo, file: target, bytes });
      return ok({ ok: true, file: target, bytes, mtimeMs: newStat.mtimeMs });
    } catch (err) {
      await appendAudit({ ok: false, action: 'save', repo, file: target });
      return gitFail(err, 'file save failed');
    }
  }

  if (pathname === '/api/clean') {
    // Never pass -x/-X: ignored files (e.g. .env, keys) must stay untouched.
    let preview;
    try {
      const out = await git(['clean', '-nd'], repo);
      preview = out.split('\n')
        .filter((l) => l.startsWith('Would remove '))
        .map((l) => l.slice('Would remove '.length));
    } catch (err) {
      return gitFail(err, 'git clean dry-run failed');
    }
    const sensitive = preview.filter(isSensitivePath);
    if (body.dryRun === true) {
      return ok({ dryRun: true, paths: preview, sensitive });
    }
    if (body.confirm !== true) return fail(400, 'clean requires confirmation');
    if (sensitive.length) return sensitiveFail(sensitive, 'cleaned');
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

  return null;
}
