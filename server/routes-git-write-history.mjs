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

export async function handleGitWriteHistory({ method, pathname, query, body, identity }, repo) {
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
    if ('error' in verdict) return fail(400, verdict.error);

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
          PR_HELPER_GIT_REBASE_PLAN: JSON.stringify(
            verdict.plan.map((item) => ({ hash: item.hash, action: item.action })),
          ),
          PR_HELPER_GIT_REWORD_MSGS: JSON.stringify(rewords),
          PR_HELPER_GIT_REWORD_STATE: stateFile,
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

  return null;
}
