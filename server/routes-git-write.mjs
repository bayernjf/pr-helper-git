import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildHunkPatch,
  cleanCommitMessage,
  git,
  numstatTarget,
  parseBlame,
  parseLog,
  parsePorcelainV2,
  parseRefs,
  parseReflog,
  parseSubmoduleStatus,
  parseTagObject,
  splitFilePatch,
} from './git.mjs';
import { buildLineSelectionPatch, MAX_SELECTED_LINES, parseHunk } from './patch-lines.mjs';
import { fail, ok } from './http.mjs';
import { buildCommitSearch } from './search-commits.mjs';
import { validateRebasePlan } from './rebase-todo.mjs';
import {
  isSensitivePath,
  normalizeRepoPath,
  resolveInside,
  sanitizeUrlForAudit,
  validateCloneUrl,
  validateFolderName,
  validateRefName,
} from './security.mjs';
import {
  addRepo,
  appendAudit,
  configPaths,
  listRepos,
  loadConfig,
  pruneRepos,
  readAudit,
  removeRepo,
  rotateAudit,
  updateConfig,
} from './store.mjs';
import { createUser, listUsers, removeUser } from './identity.mjs';
import {
  branchCommitSubjects,
  buildCommitMessagePrompt,
  buildPrDescriptionPrompt,
  complete,
  isAiConfigured,
  loadAiConfig,
  normalizeAiConfig,
  parsePrGeneration,
  publicAiConfig,
  saveAiConfig,
  stagedDiff,
  validateAiConfig,
} from './ai.mjs';
import { ensureWatching, reconcileWatching, stopWatching } from './watcher.mjs';
import {
  CONFIG_SPEC_BY_KEY,
  CONFIG_SPECS,
  CONFIG_VALUE_MAX,
  DIFF_LINE_LIMIT,
  FILE_MAX_BYTES,
  LOG_LIMIT_DEFAULT,
  LOG_LIMIT_MAX,
  NETWORK_TIMEOUT_MS,
  REBASE_TIMEOUT_MS,
  SAVE_MAX_BYTES,
  changedPaths,
  detectRepoState,
  findRegistered,
  gitDirPath,
  gitFail,
  grepArgv,
  isAdmin,
  mapLimit,
  normalizeGrepGlob,
  normalizeRebaseBase,
  parseConfigList,
  parseGrepLines,
  readBisectState,
  rebaseCommits,
  rebaseGuardrails,
  repoBrief,
  resolveParentDir,
  sensitiveChanges,
  sensitiveFail,
  unmergedPaths,
  validateDateValue,
  validateFilterValue,
  validateRefSpec,
  validateStashIndex,
} from './routes-git-helpers.mjs';

export async function handleGitWrite({ method, pathname, query, body, identity }, repo) {
  // ---------- writes ----------

  if (pathname === '/api/stage') {
    const action = body.action === 'unstage' ? 'unstage' : body.action === 'stage' ? 'stage' : null;
    if (!action) return fail(400, 'action must be "stage" or "unstage"');
    const rel = normalizeRepoPath(body.file);
    if (!rel) return fail(400, 'invalid file path');
    if (action === 'stage' && isSensitivePath(rel)) {
      return fail(403, 'sensitive files cannot be staged from the UI');
    }
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

  // Stage (or unstage) a single diff hunk rather than the whole file. The
  // authoritative diff is regenerated server side and split into hunks, so
  // the client only sends an index; the rebuilt patch is applied to the index.
  // Untracked files have no ordinary git diff and keep whole-file staging.
  if (pathname === '/api/stage-hunk') {
    const action = body.action === 'unstage' ? 'unstage' : body.action === 'stage' ? 'stage' : null;
    if (!action) return fail(400, 'action must be "stage" or "unstage"');
    const rel = normalizeRepoPath(body.file);
    if (!rel) return fail(400, 'invalid file path');
    if (action === 'stage' && isSensitivePath(rel)) {
      return fail(403, 'sensitive files cannot be staged from the UI');
    }
    const resolved = await resolveInside(repo, rel);
    if (!resolved) return fail(403, 'path escapes repo root');
    const hunkIndex = Number(body.hunk);
    if (!Number.isInteger(hunkIndex) || hunkIndex < 0) return fail(400, 'invalid hunk index');

    const diffArgs = action === 'stage'
      ? ['diff', '--', rel]
      : ['diff', '--cached', '--', rel];
    let diffText;
    try {
      diffText = await git(diffArgs, repo);
    } catch (err) {
      return gitFail(err, 'git diff failed');
    }
    const { header, hunks } = splitFilePatch(diffText);
    if (!hunks.length) return fail(400, 'no diff hunks available');
    if (hunkIndex >= hunks.length) return fail(400, 'hunk index out of range');
    const patch = buildHunkPatch(header, hunks[hunkIndex]);
    const applyArgs = ['apply', '--cached', ...(action === 'unstage' ? ['-R'] : []), '-'];
    try {
      await git(applyArgs, repo, { input: patch });
    } catch (err) {
      await appendAudit({ ok: false, action: `${action}-hunk`, repo, file: rel, hunk: hunkIndex });
      return gitFail(err, `git apply ${action} failed`);
    }
    await appendAudit({ ok: true, action: `${action}-hunk`, repo, file: rel, hunk: hunkIndex });
    return ok({ ok: true, action, file: rel, hunk: hunkIndex, hunkCount: hunks.length });
  }

  // Stage (or unstage) selected +/- lines inside one hunk. The client sends
  // body line indexes (the same numbering a unified diff shows), and the patch
  // is rebuilt from the authoritative diff regenerated here.
  if (pathname === '/api/stage-lines') {
    const action = body.action === 'unstage' ? 'unstage' : body.action === 'stage' ? 'stage' : null;
    if (!action) return fail(400, 'action must be "stage" or "unstage"');
    const rel = normalizeRepoPath(body.file);
    if (!rel) return fail(400, 'invalid file path');
    if (action === 'stage' && isSensitivePath(rel)) {
      return fail(403, 'sensitive files cannot be staged from the UI');
    }
    const resolved = await resolveInside(repo, rel);
    if (!resolved) return fail(403, 'path escapes repo root');
    const hunkIndex = Number(body.hunk);
    if (!Number.isInteger(hunkIndex) || hunkIndex < 0) return fail(400, 'invalid hunk index');
    if (!Array.isArray(body.lines) || body.lines.length === 0) return fail(400, 'no lines selected');
    if (body.lines.length > MAX_SELECTED_LINES) return fail(400, 'too many lines selected');
    const selected = [...new Set(body.lines.map(Number))];
    if (selected.some((n) => !Number.isInteger(n) || n < 0)) return fail(400, 'invalid line index');

    let diffText;
    try {
      diffText = await git(action === 'stage' ? ['diff', '--', rel] : ['diff', '--cached', '--', rel], repo);
    } catch (err) {
      return gitFail(err, 'git diff failed');
    }
    const { header, hunks } = splitFilePatch(diffText);
    if (!hunks.length) return fail(400, 'no diff hunks available');
    if (hunkIndex >= hunks.length) return fail(400, 'hunk index out of range');
    const parsed = parseHunk(hunks[hunkIndex]);
    if (!parsed) return fail(400, 'cannot parse the hunk header');
    if (selected.some((n) => n >= parsed.lines.length)) return fail(400, 'line index out of range');
    const patch = buildLineSelectionPatch(header, hunks[hunkIndex], selected, action);
    if (!patch) return fail(400, 'select at least one changed line');
    const applyArgs = ['apply', '--cached', ...(action === 'unstage' ? ['-R'] : []), '-'];
    try {
      await git(applyArgs, repo, { input: patch });
    } catch (err) {
      await appendAudit({ ok: false, action: `${action}-lines`, repo, file: rel, hunk: hunkIndex, count: selected.length });
      return gitFail(err, `git apply ${action} failed`);
    }
    await appendAudit({ ok: true, action: `${action}-lines`, repo, file: rel, hunk: hunkIndex, count: selected.length });
    return ok({ ok: true, action, file: rel, hunk: hunkIndex, count: selected.length, hunkCount: hunks.length });
  }

  if (pathname === '/api/discard-hunk') {
    if (body.confirm !== true) return fail(400, 'discard requires confirm: true');
    const rel = normalizeRepoPath(body.file);
    if (!rel) return fail(400, 'invalid file path');
    if (isSensitivePath(rel)) return fail(403, 'sensitive files cannot be discarded here');
    const resolved = await resolveInside(repo, rel);
    if (!resolved) return fail(403, 'path escapes repo root');
    const hunkIndex = Number(body.hunk);
    if (!Number.isInteger(hunkIndex) || hunkIndex < 0) return fail(400, 'invalid hunk index');

    let diffText;
    try {
      diffText = await git(['diff', '--', rel], repo);
    } catch (err) {
      return gitFail(err, 'git diff failed');
    }
    const { header, hunks } = splitFilePatch(diffText);
    if (!hunks.length) return fail(400, 'no diff hunks available');
    if (hunkIndex >= hunks.length) return fail(400, 'hunk index out of range');
    const patch = buildHunkPatch(header, hunks[hunkIndex]);
    try {
      // Reverse-apply to the working tree only; the index is never touched.
      await git(['apply', '-R', '-'], repo, { input: patch });
    } catch (err) {
      await appendAudit({ ok: false, action: 'discard-hunk', repo, file: rel, hunk: hunkIndex });
      return gitFail(err, 'git apply discard failed');
    }
    await appendAudit({ ok: true, action: 'discard-hunk', repo, file: rel, hunk: hunkIndex });
    return ok({ ok: true, file: rel, hunk: hunkIndex, hunkCount: hunks.length });
  }

  if (pathname === '/api/stage-all') {
    const action = body.action === 'unstage' ? 'unstage' : 'stage';
    if (action === 'stage') {
      const sensitive = await sensitiveChanges(repo);
      if (sensitive.length) return sensitiveFail(sensitive, 'staged');
    }
    let argv;
    if (action === 'stage') {
      argv = ['add', '--all'];
    } else {
      // `git restore --staged .` needs a HEAD commit; in a freshly initialised
      // repository it fails with "could not resolve 'HEAD'". Drop the index
      // entries directly instead so unstage-all also works before the first
      // commit.
      const hasHead = await git(['rev-parse', '--verify', '--quiet', 'HEAD'], repo)
        .then(() => true)
        .catch(() => false);
      argv = hasHead ? ['restore', '--staged', '.'] : ['rm', '--cached', '-r', '--', '.'];
    }
    try {
      await git(argv, repo);
    } catch (err) {
      return gitFail(err, `git ${action} all failed`);
    }
    await appendAudit({ ok: true, action: `${action}-all`, repo });
    return ok({ ok: true, action });
  }

  if (pathname === '/api/commit') {
    const raw = typeof body.message === 'string' ? body.message : '';
    const message = cleanCommitMessage(raw);
    if (!message) return fail(400, 'commit message must not be empty');
    if (message.length > 500) return fail(400, 'commit message must be at most 500 characters');
    if (message.startsWith('-') || message.includes('\0')) return fail(400, 'invalid commit message');
    const allowEmpty = body.allowEmpty === true;
    try {
      const sensitive = await sensitiveChanges(repo, { stagedOnly: true });
      if (sensitive.length) return sensitiveFail(sensitive, 'committed');
      const staged = await git(['diff', '--cached', '--name-only'], repo);
      // A merge resolved to "ours" leaves an index identical to HEAD; the commit
      // still has to go through to record MERGE_HEAD, so only block staged-less
      // commits outside a merge.
      if (!staged.trim() && !allowEmpty) {
        const state = await detectRepoState(repo);
        if (!state.mergeInProgress) return fail(409, 'nothing staged to commit');
      }
      const commitArgs = ['commit'];
      if (allowEmpty) commitArgs.push('--allow-empty');
      commitArgs.push('-F', '-');
      await git(commitArgs, repo, { input: `${message}\n` });
      const sha = (await git(['rev-parse', 'HEAD'], repo)).trim();
      await appendAudit({ ok: true, action: 'commit', repo, commit: sha, allowEmpty });
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
    const reserved = new Set(['HEAD', 'FETCH_HEAD', 'ORIG_HEAD', 'MERGE_HEAD', 'CHERRY_PICK_HEAD']);
    let argv;
    let tracked = false;
    try {
      // A remote-tracking branch such as "origin/feature" should switch to (or
      // create) a local tracking branch, rather than leaving the user in a
      // detached HEAD state.
      const remotes = (await git(['remote'], repo))
        .split('\n').map((r) => r.trim()).filter(Boolean);
      const remoteMatch = remotes
        .filter((remote) => ref.startsWith(`${remote}/`))
        .sort((a, b) => b.length - a.length)[0];
      const remoteRefExists = remoteMatch
        ? await git(['rev-parse', '--verify', '--quiet', `refs/remotes/${ref}`], repo)
          .then(() => true).catch(() => false)
        : false;
      if (remoteMatch && remoteRefExists) {
        const localName = ref.slice(remoteMatch.length + 1);
        if (reserved.has(localName)) {
          argv = ['checkout', ref];
        } else {
          const localExists = await git(['rev-parse', '--verify', '--quiet', `refs/heads/${localName}`], repo)
            .then(() => true).catch(() => false);
          if (localExists) {
            argv = ['checkout', localName];
          } else {
            if (!validateRefName(localName)) return fail(400, 'invalid derived branch name');
            argv = ['checkout', '-b', localName, '--track', ref];
            tracked = true;
          }
        }
      } else {
        // No "--" separator: local branches, tags and SHAs use plain checkout.
        argv = ['checkout', ref];
      }
      await git(argv, repo);
    } catch (err) {
      return gitFail(err, 'git checkout failed');
    }
    await appendAudit({ ok: true, action: 'checkout', repo, ref, tracked });
    return ok({ ok: true, ref, tracked });
  }

  if (pathname === '/api/pr/checkout') {
    // Materialize a GitHub pull request as a local branch without switching:
    // `git fetch origin pull/<n>/head` writes FETCH_HEAD, then `git branch`
    // points the new branch at it. The working tree is never touched.
    const number = Number(body.number);
    if (!Number.isInteger(number) || number < 1 || number > 1_000_000) {
      return fail(400, 'invalid pull request number');
    }
    const branch = validateRefName(body.branch || `pr-${number}`);
    if (!branch) return fail(400, 'invalid branch name');
    try {
      await git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], repo);
      return fail(409, `branch ${branch} already exists`);
    } catch { /* expected: the branch must not exist yet */ }
    try {
      await git(['fetch', 'origin', `pull/${number}/head`], repo, { timeout: NETWORK_TIMEOUT_MS });
    } catch (err) {
      await appendAudit({ ok: false, action: 'pr-checkout', repo, number });
      return gitFail(err, 'fetching the pull request head failed');
    }
    const sha = (await git(['rev-parse', 'FETCH_HEAD'], repo)).trim();
    try {
      await git(['branch', '--', branch, sha], repo);
    } catch (err) {
      await appendAudit({ ok: false, action: 'pr-checkout', repo, number, branch });
      return gitFail(err, 'creating the local branch failed');
    }
    await appendAudit({ ok: true, action: 'pr-checkout', repo, number, branch, sha });
    return ok({ ok: true, branch, sha });
  }

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

  if (pathname === '/api/merge') {
    const ref = validateRefName(body.ref);
    if (!ref) return fail(400, 'invalid ref name');
    const strategy = body.strategy === 'no-ff' || body.strategy === 'ff-only' || body.strategy === 'squash'
      ? body.strategy
      : 'default';
    const argv = ['merge'];
    if (strategy === 'no-ff') argv.push('--no-ff', '--no-edit');
    else if (strategy === 'ff-only') argv.push('--ff-only');
    else if (strategy === 'squash') argv.push('--squash');
    else argv.push('--no-edit');
    argv.push('--', ref);
    try {
      const result = await git(argv, repo);
      await appendAudit({ ok: true, action: 'merge', repo, ref, strategy });
      return ok({ ok: true, ref, strategy, result: result.trim() });
    } catch (err) {
      // A conflicted merge keeps MERGE_HEAD behind; report 409 with the list so
      // the UI can show the conflict banner instead of a generic 400.
      const state = await detectRepoState(repo);
      if (state.mergeInProgress) {
        const conflicts = await unmergedPaths(repo);
        await appendAudit({ ok: false, action: 'merge', repo, ref, strategy, conflicts: conflicts.length });
        return {
          status: 409,
          json: { error: 'merge stopped on conflicts', detail: err.stderr || err.message, conflicts, state },
        };
      }
      await appendAudit({ ok: false, action: 'merge', repo, ref, strategy });
      return gitFail(err, 'git merge failed (resolve conflicts before continuing)');
    }
  }

  if (pathname === '/api/merge/abort') {
    try {
      const result = await git(['merge', '--abort'], repo);
      await appendAudit({ ok: true, action: 'merge-abort', repo });
      return ok({ ok: true, result: result.trim() });
    } catch (err) {
      await appendAudit({ ok: false, action: 'merge-abort', repo });
      return gitFail(err, 'git merge --abort failed');
    }
  }

  // Interactive rebase: reorder, reword, squash, fixup, drop and edit, driven by
  // the two shims in server/rebase-{sequence,msg}.mjs. Nothing here trusts the
  // browser's commit list — the plan is validated against the range we re-read.
  if (pathname === '/api/rebase/interactive') {
    const base = normalizeRebaseBase(body.base);
    if (!base) return fail(400, 'invalid rebase base');
    let commits;
    try {
      commits = await rebaseCommits(repo, base);
    } catch (err) {
      return gitFail(err, 'cannot list commits to rebase');
    }
    const guardrails = await rebaseGuardrails(repo, commits);
    if (guardrails.dirty) return fail(409, 'working tree has changes; commit or stash them first');
    if (guardrails.merges.length) {
      return fail(409, `refusing to flatten merge commits: ${guardrails.merges.join(', ')}`);
    }
    const verdict = validateRebasePlan(
      commits.map((c) => ({ hash: c.hash, subject: c.subject })),
      body.commands,
    );
    if (verdict.error) return fail(400, verdict.error);

    const state = await detectRepoState(repo);
    if (state.rebaseInProgress || state.mergeInProgress || state.revertInProgress) {
      return fail(409, 'another multi-step operation is in progress; finish or abort it first');
    }

    const serverDir = path.dirname(fileURLToPath(import.meta.url));
    const shim = (name) => `'${process.execPath}' '${path.join(serverDir, name)}'`;
    const rewords = verdict.plan
      .filter((item) => item.action === 'reword')
      .map((item) => ({ subject: item.subject, message: item.message }));
    const stateDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'git2-rebase-'));
    const stateFile = path.join(stateDir, 'rewords.json');
    await fsp.writeFile(stateFile, JSON.stringify(rewords), 'utf8');
    try {
      const args = base === 'root' ? ['rebase', '-i', '--root'] : ['rebase', '-i', base];
      await git(args, repo, {
        env: {
          GIT_SEQUENCE_EDITOR: shim('rebase-sequence.mjs'),
          GIT_EDITOR: shim('rebase-msg.mjs'),
          GIT2_REBASE_PLAN: JSON.stringify(
            verdict.plan.map((item) => ({ hash: item.hash, action: item.action })),
          ),
          GIT2_REWORD_MSGS: JSON.stringify(rewords),
          GIT2_REWORD_STATE: stateFile,
        },
        timeout: REBASE_TIMEOUT_MS,
      });
    } catch (err) {
      const after = await detectRepoState(repo);
      if (after.rebaseInProgress) {
        // A conflict is a normal outcome; the rebase banner offers continue/abort.
        await appendAudit({ ok: true, action: 'rebase-interactive', repo, conflicted: true });
        return ok({ ok: true, conflicted: true });
      }
      await appendAudit({ ok: false, action: 'rebase-interactive', repo });
      return gitFail(err, 'git rebase failed');
    } finally {
      await fsp.rm(stateDir, { recursive: true, force: true }).catch(() => undefined);
    }
    await appendAudit({ ok: true, action: 'rebase-interactive', repo, commits: commits.length });
    return ok({ ok: true, conflicted: false, commits: commits.length });
  }

  if (pathname === '/api/rebase/continue') {
    // GIT_EDITOR=true lets the command finish non-interactively when only the
    // editor would block it; unresolved conflicts still fail as expected.
    const env = { ...process.env, GIT_EDITOR: 'true' };
    try {
      const result = await git(['rebase', '--continue'], repo, { env });
      await appendAudit({ ok: true, action: 'rebase-continue', repo });
      return ok({ ok: true, result: result.trim() });
    } catch (err) {
      await appendAudit({ ok: false, action: 'rebase-continue', repo });
      return gitFail(err, 'git rebase --continue failed');
    }
  }

  if (pathname === '/api/rebase/abort') {
    try {
      const result = await git(['rebase', '--abort'], repo);
      await appendAudit({ ok: true, action: 'rebase-abort', repo });
      return ok({ ok: true, result: result.trim() });
    } catch (err) {
      await appendAudit({ ok: false, action: 'rebase-abort', repo });
      return gitFail(err, 'git rebase --abort failed');
    }
  }

  if (pathname === '/api/bisect/start') {
    if (method !== 'POST') return fail(405, 'method not allowed');
    const bad = typeof body.bad === 'string' && /^[0-9a-f]{7,40}$/.test(body.bad.trim())
      ? body.bad.trim()
      : null;
    const good = typeof body.good === 'string' && /^[0-9a-f]{7,40}$/.test(body.good.trim())
      ? body.good.trim()
      : null;
    if (!bad || !good) return fail(400, 'good and bad must be commit shas');
    if (bad === good) return fail(400, 'good and bad must differ');
    try {
      const started = await git(['bisect', 'start'], repo);
      const markedBad = await git(['bisect', 'bad', bad], repo);
      const markedGood = await git(['bisect', 'good', good], repo);
      const message = (started + markedBad + markedGood)
        .split('\n').filter((line) => line.trim()).join('\n');
      await appendAudit({ ok: true, action: 'bisect-start', repo, good, bad });
      return ok({ ok: true, message, state: await readBisectState(repo) });
    } catch (err) {
      // A half-started session leaves HEAD detached at a random commit, so
      // reset best-effort instead of stranding the user.
      await git(['bisect', 'reset'], repo).catch(() => '');
      await appendAudit({ ok: false, action: 'bisect-start', repo, good, bad });
      return gitFail(err, 'git bisect start failed');
    }
  }

  if (pathname === '/api/bisect/mark') {
    if (method !== 'POST') return fail(405, 'method not allowed');
    const verdict = body.verdict === 'good' || body.verdict === 'bad' ? body.verdict : null;
    if (!verdict) return fail(400, 'verdict must be good or bad');
    if (!(await readBisectState(repo)).active) return fail(400, 'no bisect in progress');
    try {
      const out = await git(['bisect', verdict], repo);
      const message = out.split('\n').filter((line) => line.trim()).join('\n');
      await appendAudit({ ok: true, action: 'bisect-mark', repo, verdict });
      return ok({ ok: true, message, state: await readBisectState(repo) });
    } catch (err) {
      await appendAudit({ ok: false, action: 'bisect-mark', repo, verdict });
      return gitFail(err, `git bisect ${verdict} failed`);
    }
  }

  if (pathname === '/api/bisect/reset') {
    if (method !== 'POST') return fail(405, 'method not allowed');
    if (!(await readBisectState(repo)).active) return fail(400, 'no bisect in progress');
    try {
      const out = await git(['bisect', 'reset'], repo);
      await appendAudit({ ok: true, action: 'bisect-reset', repo });
      return ok({ ok: true, message: out.trim(), state: await readBisectState(repo) });
    } catch (err) {
      await appendAudit({ ok: false, action: 'bisect-reset', repo });
      return gitFail(err, 'git bisect reset failed');
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

  // Apply one commit from anywhere in the graph onto the current branch.
  if (pathname === '/api/cherry-pick') {
    if (method !== 'POST') return fail(405, 'method not allowed');
    const sha = typeof body.sha === 'string' && /^[0-9a-f]{7,40}$/.test(body.sha.trim())
      ? body.sha.trim()
      : null;
    if (!sha) return fail(400, 'invalid commit sha');
    try {
      const result = await git(['cherry-pick', sha], repo);
      await appendAudit({ ok: true, action: 'cherry-pick', repo, sha });
      return ok({ ok: true, picked: sha, result: result.trim() });
    } catch (err) {
      // A conflict keeps CHERRY_PICK_HEAD behind so the repository stays in the
      // cherry-picking state; report the conflict count instead of a bare error.
      let conflicts = [];
      try {
        conflicts = (await git(['diff', '--name-only', '--diff-filter=U'], repo))
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
      } catch { /* ignore */ }
      await appendAudit({ ok: false, action: 'cherry-pick', repo, sha, conflicts: conflicts.length });
      if (conflicts.length) {
        return {
          status: 409,
          json: { error: 'cherry-pick stopped on conflicts', detail: err.stderr || err.message, conflicts },
        };
      }
      return gitFail(err, 'git cherry-pick failed');
    }
  }

  // Undo the newest commit on the current branch, keeping its changes staged.
  if (pathname === '/api/undo-commit') {
    if (method !== 'POST') return fail(405, 'method not allowed');
    try {
      await git(['reset', '--soft', 'HEAD~1'], repo);
      await appendAudit({ ok: true, action: 'commit-undo', repo });
      return ok({ ok: true });
    } catch (err) {
      await appendAudit({ ok: false, action: 'commit-undo', repo });
      return gitFail(err, 'git reset --soft HEAD~1 failed (no parent commit?)');
    }
  }

  if (pathname === '/api/revert') {
    const sha = typeof body.sha === 'string' && /^[0-9a-f]{7,40}$/.test(body.sha.trim())
      ? body.sha.trim()
      : null;
    if (!sha) return fail(400, 'invalid commit sha');
    try {
      // Merge commits need an explicit mainline parent (-m). The number is
      // 1-based: parent 1 is the branch you were on when merging.
      const parents = (await git(['rev-list', '--parents', '-n', '1', sha], repo))
        .trim()
        .split(/\s+/);
      const parentCount = parents.length - 1;
      let mainline = null;
      if (parentCount > 1) {
        const requested = Number(body.mainline);
        if (!Number.isInteger(requested) || requested < 1 || requested > parentCount) {
          return fail(
            400,
            'reverting a merge commit needs a valid mainline parent',
            `choose mainline 1..${parentCount}`,
          );
        }
        mainline = requested;
      }
      const argv = ['revert', '--no-edit'];
      if (mainline !== null) argv.push('-m', String(mainline));
      argv.push(sha);
      const result = await git(argv, repo);
      await appendAudit({ ok: true, action: 'revert', repo, sha, mainline });
      return ok({ ok: true, reverted: sha, mainline, result: result.trim() });
    } catch (err) {
      // A conflicting revert leaves the repository in a "reverting" state.
      // Keep that state so the user can resolve the conflicts in place and
      // then continue (or explicitly abort), instead of losing the work.
      const state = await detectRepoState(repo);
      if (state.revertInProgress) {
        const conflicts = await unmergedPaths(repo);
        await appendAudit({ ok: false, action: 'revert', repo, sha, conflicts: conflicts.length });
        return {
          status: 409,
          json: {
            error: 'revert stopped on conflicts',
            detail: err.stderr || err.message,
            conflicts,
            state,
          },
        };
      }
      await appendAudit({ ok: false, action: 'revert', repo, sha });
      return gitFail(err, 'git revert failed');
    }
  }

  // Revert several commits in one command. Merge commits are rejected here
  // because they need a per-commit mainline choice; revert those individually.
  if (pathname === '/api/revert-batch') {
    const raw = Array.isArray(body.shas) ? body.shas : [];
    const shas = [];
    for (const item of raw) {
      if (typeof item !== 'string' || !/^[0-9a-f]{7,40}$/.test(item.trim())) {
        return fail(400, 'every item must be a valid commit sha');
      }
      const sha = item.trim();
      if (!shas.includes(sha)) shas.push(sha);
    }
    if (shas.length < 2) return fail(400, 'provide at least two shas');
    if (shas.length > 25) return fail(400, 'too many shas (max 25)');
    try {
      // Reject merge commits before touching the working tree.
      for (const sha of shas) {
        const line = (await git(['rev-list', '--parents', '-n', '1', sha], repo)).trim().split(/\s+/);
        if (line.length - 1 > 1) {
          return fail(400, 'batch revert cannot include merge commits', `revert ${sha} individually`);
        }
      }
      // Revert newest first: `git revert` applies the commits sequentially, so
      // undoing the newest change before the older ones avoids the conflicts
      // that occur when an older commit is reverted while its dependants still
      // exist. The caller (the graph) sends commits in history order.
      const result = await git(['revert', '--no-edit', ...shas], repo);
      await appendAudit({ ok: true, action: 'revert-batch', repo, count: shas.length, shas });
      return ok({ ok: true, reverted: shas, count: shas.length, result: result.trim() });
    } catch (err) {
      const state = await detectRepoState(repo);
      if (state.revertInProgress) {
        const conflicts = await unmergedPaths(repo);
        await appendAudit({ ok: false, action: 'revert-batch', repo, shas, conflicts: conflicts.length });
        return {
          status: 409,
          json: {
            error: 'revert stopped on conflicts',
            detail: err.stderr || err.message,
            conflicts,
            state,
          },
        };
      }
      await appendAudit({ ok: false, action: 'revert-batch', repo, shas });
      return gitFail(err, 'batch git revert failed');
    }
  }

  // Finish a conflicted revert after the user resolved the files. GIT_EDITOR
  // keeps the command non-interactive; remaining unmerged paths are rejected
  // here with a clear message instead of a bare git failure.
  if (pathname === '/api/revert/continue') {
    const state = await detectRepoState(repo);
    if (!state.revertInProgress) return fail(409, 'no revert in progress');
    const conflicts = await unmergedPaths(repo);
    if (conflicts.length) {
      return fail(409, 'unresolved conflicts remain', conflicts.join(', '));
    }
    const env = { ...process.env, GIT_EDITOR: 'true' };
    try {
      const result = await git(['revert', '--continue'], repo, { env });
      await appendAudit({ ok: true, action: 'revert-continue', repo });
      return ok({ ok: true, result: result.trim() });
    } catch (err) {
      await appendAudit({ ok: false, action: 'revert-continue', repo });
      return gitFail(err, 'git revert --continue failed');
    }
  }

  if (pathname === '/api/revert/abort') {
    try {
      const result = await git(['revert', '--abort'], repo);
      await appendAudit({ ok: true, action: 'revert-abort', repo });
      return ok({ ok: true, result: result.trim() });
    } catch (err) {
      await appendAudit({ ok: false, action: 'revert-abort', repo });
      return gitFail(err, 'git revert --abort failed');
    }
  }

  // Take one side of a conflicted file and stage it. "ours" is the current
  // branch, "theirs" the incoming side (rebase inverts these internally, so
  // the UI labels them by side, not by branch); "mark" stages the file as-is
  // after a manual edit.
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
