import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { git }from './git.mjs'
import { fail, ok } from './http.mjs';
import { appendAudit }from './store.mjs'
import { gitFail, sensitiveChanges, sensitiveFail, validateStashIndex }from './routes-git-helpers.mjs'

export async function handleGitWriteStash({ method, pathname, query, body, identity }, repo) {
  if (pathname === '/api/stash/create') {
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (message.length > 200) return fail(400, 'stash message too long');
    const includeUntracked = body.includeUntracked === true;
    if (includeUntracked) {
      const sensitive = await sensitiveChanges(repo);
      if (sensitive.length) return sensitiveFail(sensitive, 'stashed with untracked files');
    }
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
