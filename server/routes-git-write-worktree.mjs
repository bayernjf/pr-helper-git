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

export async function handleGitWriteWorktree({ method, pathname, query, body, identity }, repo) {
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

  return null;
}
