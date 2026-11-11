import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { git, parsePorcelainV2 }from './git.mjs'
import { fail, ok } from './http.mjs';
import { validateRefName }from './security.mjs'
import { appendAudit }from './store.mjs'
import { NETWORK_TIMEOUT_MS, gitFail }from './routes-git-helpers.mjs'

export async function handleGitWriteNetwork({ method, pathname, query, body, identity }, repo) {
  if (pathname === '/api/tag/push') {
    const name = validateRefName(typeof body.name === 'string' ? body.name : '');
    const remoteName = typeof body.remote === 'string' && body.remote.trim()
      ? body.remote.trim()
      : 'origin';
    if (!name) return fail(400, 'invalid tag name');
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(remoteName)) return fail(400, 'invalid remote name');
    try {
      const result = await git(['push', remoteName, name], repo, { timeout: NETWORK_TIMEOUT_MS });
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
      await git(argv, repo, { timeout: NETWORK_TIMEOUT_MS });
    } catch (err) {
      return gitFail(err, 'git fetch failed');
    }
    await appendAudit({ ok: true, action: 'fetch', repo, prune });
    return ok({ ok: true });
  }

  if (pathname === '/api/pull') {
    const rebase = body.rebase === true;
    try {
      const argv = rebase ? ['pull', '--rebase'] : ['pull', '--no-edit'];
      const result = await git(argv, repo, { timeout: NETWORK_TIMEOUT_MS });
      await appendAudit({ ok: true, action: 'pull', repo, rebase });
      return ok({ ok: true, rebase, result: result.trim() });
    } catch (err) {
      await appendAudit({ ok: false, action: 'pull', repo, rebase });
      return gitFail(err, 'git pull failed');
    }
  }

  if (pathname === '/api/push') {
    const forceMode = body.force === 'force' || body.force === 'force-with-lease'
      ? body.force
      : null;
    if (forceMode && body.confirm !== true) {
      return fail(400, 'force push requires confirm: true');
    }
    try {
      let argv = ['push'];
      if (body.setUpstream) {
        const status = parsePorcelainV2(await git(['status', '--porcelain=v2', '--branch'], repo));
        if (!status.branch) return fail(400, 'detached HEAD cannot be pushed with upstream');
        argv = ['push', '-u', 'origin', status.branch];
      }
      if (forceMode === 'force') argv.push('--force');
      else if (forceMode === 'force-with-lease') argv.push('--force-with-lease');
      const result = await git(argv, repo, { timeout: NETWORK_TIMEOUT_MS });
      await appendAudit({ ok: true, action: 'push', repo, force: forceMode || 'none' });
      return ok({ ok: true, force: forceMode || 'none', result: result.trim() });
    } catch (err) {
      await appendAudit({ ok: false, action: 'push', repo, force: forceMode || 'none' });
      return gitFail(err, 'git push failed');
    }
  }

  return null;
}
