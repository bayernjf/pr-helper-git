import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cleanCommitMessage, git }from './git.mjs'
import { fail, ok } from './http.mjs';
import { validateCloneUrl, validateRefName }from './security.mjs'
import { appendAudit }from './store.mjs'
import { NETWORK_TIMEOUT_MS, gitFail, sensitiveChanges, sensitiveFail }from './routes-git-helpers.mjs'

export async function handleGitWriteRefs({ method, pathname, query, body, identity }, repo) {
  if (pathname === '/api/branch/create') {
    const name = validateRefName(body.name);
    if (!name) return fail(400, 'invalid branch name');
    const noCheckout = body.noCheckout === true;
    const argv = noCheckout ? ['branch', name] : ['checkout', '-b', name];
    if (body.from) {
      const from = validateRefName(body.from);
      if (!from) return fail(400, 'invalid start ref');
      // No "--" here: `git checkout -b x -- ref` parses ref as a pathspec
      // and fails with "<ref> is not a commit". validateRefName already
      // prevents option-like values.
      argv.push(from);
    }
    try {
      await git(argv, repo);
    } catch (err) {
      return gitFail(err, 'branch creation failed');
    }
    await appendAudit({ ok: true, action: 'branch-create', repo, branch: name, noCheckout });
    return ok({ ok: true, branch: name, switched: !noCheckout });
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

  if (pathname === '/api/branch/set-upstream') {
    const upstream = validateRefName(body.upstream);
    if (!upstream) return fail(400, 'invalid upstream ref');
    const argv = ['branch', `--set-upstream-to=${upstream}`];
    if (body.branch) {
      const branch = validateRefName(body.branch);
      if (!branch) return fail(400, 'invalid branch name');
      argv.push(branch);
    }
    try {
      await git(argv, repo);
    } catch (err) {
      return gitFail(err, 'set upstream failed');
    }
    await appendAudit({ ok: true, action: 'branch-set-upstream', repo, upstream });
    return ok({ ok: true, upstream });
  }

  if (pathname === '/api/tag/create') {
    const name = validateRefName(body.name);
    if (!name) return fail(400, 'invalid tag name');
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (message.length > 300) return fail(400, 'tag message too long');
    const force = body.force === true;
    const argv = message
      ? ['tag', '-a', name, '-m', message]
      : ['tag', name];
    if (force) argv.splice(1, 0, '-f');
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
    await appendAudit({ ok: true, action: 'tag-create', repo, tag: name, annotated: !!message, force });
    return ok({ ok: true, tag: name, force });
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

  if (pathname === '/api/tag/delete-remote') {
    const name = validateRefName(body.name);
    if (!name) return fail(400, 'invalid tag name');
    const remoteName = typeof body.remote === 'string' && body.remote.trim()
      ? body.remote.trim()
      : 'origin';
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(remoteName)) return fail(400, 'invalid remote name');
    if (body.confirm !== true) return fail(400, 'remote tag deletion requires confirmation');
    try {
      const result = await git(['push', remoteName, '--delete', name], repo, { timeout: NETWORK_TIMEOUT_MS });
      await appendAudit({ ok: true, action: 'tag-delete-remote', repo, tag: name, remote: remoteName });
      return ok({ ok: true, tag: name, remote: remoteName, result: result.trim() });
    } catch (err) {
      await appendAudit({ ok: false, action: 'tag-delete-remote', repo, tag: name, remote: remoteName });
      return gitFail(err, 'remote tag deletion failed');
    }
  }

  if (pathname === '/api/branch/push') {
    const name = validateRefName(body.name);
    if (!name) return fail(400, 'invalid branch name');
    const remoteName = typeof body.remote === 'string' && body.remote.trim()
      ? body.remote.trim()
      : 'origin';
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(remoteName)) return fail(400, 'invalid remote name');
    try {
      await git(['push', '-u', remoteName, name], repo, { timeout: NETWORK_TIMEOUT_MS });
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
      await git(['push', remoteName, '--delete', name], repo, { timeout: NETWORK_TIMEOUT_MS });
    } catch (err) {
      return gitFail(err, 'remote branch deletion failed');
    }
    await appendAudit({ ok: true, action: 'branch-delete-remote', repo, remote: remoteName, branch: name });
    return ok({ ok: true, branch: name });
  }

  if (pathname === '/api/amend') {
    const message = cleanCommitMessage(typeof body.message === 'string' ? body.message : '');
    if (!message) return fail(400, 'amend message must not be empty');
    if (message.length > 500 || message.startsWith('-') || message.includes('\0')) {
      return fail(400, 'invalid amend message');
    }
    try {
      // Amend rewrites HEAD, so refuse to fold staged sensitive files into it,
      // matching the /api/commit guard.
      const sensitive = await sensitiveChanges(repo, { stagedOnly: true });
      if (sensitive.length) return sensitiveFail(sensitive, 'amended');
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

  if (pathname === '/api/remote/rename') {
    const oldName = typeof body.oldName === 'string' ? body.oldName.trim() : '';
    const newName = typeof body.newName === 'string' ? body.newName.trim() : '';
    const nameRe = /^[A-Za-z0-9._-]{1,64}$/;
    if (!nameRe.test(oldName) || oldName.startsWith('-')
      || !nameRe.test(newName) || newName.startsWith('-')) {
      return fail(400, 'invalid remote name');
    }
    try {
      await git(['remote', 'rename', oldName, newName], repo);
      await appendAudit({ ok: true, action: 'remote-rename', repo, oldName, newName });
      return ok({ ok: true, oldName, newName });
    } catch (err) {
      await appendAudit({ ok: false, action: 'remote-rename', repo, oldName, newName });
      return gitFail(err, 'git remote rename failed');
    }
  }

  return null;
}
