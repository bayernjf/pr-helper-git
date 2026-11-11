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
  COMPARE_WORKTREE,
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
  validateCompareRef,
  validateDateValue,
  validateFilterValue,
  validateRefSpec,
  validateStashIndex,
} from './routes-git-helpers.mjs';

export async function handleGitRead({ method, pathname, query, body, identity }, repo) {
  // ---------- reads ----------

  if (pathname === '/api/status' && method === 'GET') {
    try {
      const raw = await git(['status', '--porcelain=v2', '--branch'], repo);
      const status = parsePorcelainV2(raw);
      const state = await detectRepoState(repo);
      return ok({ collectedAt: new Date().toISOString(), repo, status, state });
    } catch (err) {
      return gitFail(err, 'git status failed');
    }
  }

  // Read the configured `commit.template` (git config) and its content so the
  // commit form can prefill it. A missing config is a normal "not configured".
  if (pathname === '/api/commit-template' && method === 'GET') {
    let configuredPath;
    try {
      configuredPath = (await git(['config', '--get', 'commit.template'], repo)).trim();
    } catch (err) {
      if (err && err.code === 1) return ok({ configured: false });
      return gitFail(err, 'git config failed');
    }
    if (!configuredPath) return ok({ configured: false });
    // Relative template paths resolve inside the repository; absolute paths
    // (a common global template in the home directory) are read directly.
    let resolved;
    if (path.isAbsolute(configuredPath)) {
      resolved = path.resolve(configuredPath);
    } else {
      resolved = await resolveInside(repo, configuredPath);
      if (!resolved) return fail(403, 'template path escapes repo root');
    }
    try {
      const stat = await fsp.stat(resolved);
      if (stat.size > SAVE_MAX_BYTES) return fail(400, 'commit template too large');
      const text = (await fsp.readFile(resolved, 'utf8'))
        .replace(/\r\n/g, '\n')
        .split('\n')
        .filter((line) => !line.startsWith('#'))
        .join('\n');
      return ok({ configured: true, path: configuredPath, text });
    } catch (err) {
      return fail(400, 'cannot read commit template', err.message);
    }
  }

  // View the whitelisted git config keys, reporting both the repository-local
  // value and the effective value (which may be inherited from global/system).
  if (pathname === '/api/config' && method === 'GET') {
    let localRaw;
    let effectiveRaw;
    try {
      localRaw = await git(['config', '--local', '--list'], repo);
    } catch (err) {
      return gitFail(err, 'git config failed');
    }
    try {
      effectiveRaw = await git(['config', '--list'], repo);
    } catch (err) {
      return gitFail(err, 'git config failed');
    }
    const localMap = parseConfigList(localRaw);
    const effectiveMap = parseConfigList(effectiveRaw);
    const entries = CONFIG_SPECS.map((spec) => ({
      key: spec.key,
      type: spec.type,
      ...(spec.options ? { options: spec.options } : {}),
      local: localMap[spec.key] ?? null,
      effective: effectiveMap[spec.key] ?? null,
      inherited: !(spec.key in localMap),
    }));
    return ok({ entries });
  }

  // Update a single whitelisted key in the repository-local config. An empty
  // value unsets the local override so the inherited value takes effect again.
  if (pathname === '/api/config' && method === 'POST') {
    const key = typeof body.key === 'string' ? body.key : '';
    const spec = CONFIG_SPEC_BY_KEY.get(key);
    if (!spec) return fail(400, 'config key is not allowed');
    if (typeof body.value !== 'string') return fail(400, 'config value must be a string');
    const value = body.value.trim();
    if (value === '') {
      try {
        await git(['config', '--local', '--unset', key], repo);
      } catch (err) {
        // git exits 5 when the key is not set; that is already the target.
        if (!err || err.code !== 5) return gitFail(err, 'git config unset failed');
      }
      await appendAudit({ ok: true, action: 'config', repo, key, unset: true });
      return ok({ ok: true, key, local: null });
    }
    if (value.includes('\0') || value.includes('\n') || value.length > CONFIG_VALUE_MAX) {
      return fail(400, 'invalid config value');
    }
    if (spec.type === 'enum' && !spec.options.includes(value)) {
      return fail(400, 'invalid config value');
    }
    if (spec.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return fail(400, 'invalid email address');
    }
    if (spec.type === 'branch' && !validateRefName(value)) {
      return fail(400, 'invalid branch name');
    }
    try {
      await git(['config', '--local', key, value], repo);
      await appendAudit({ ok: true, action: 'config', repo, key });
      return ok({ ok: true, key, local: value });
    } catch (err) {
      await appendAudit({ ok: false, action: 'config', repo, key });
      return gitFail(err, 'git config failed');
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
    // Optional pathspec: restrict history to commits touching a file/dir.
    const pathFilter = query.get('path') ? normalizeRepoPath(query.get('path')) : null;
    if (query.get('path') && !pathFilter) return fail(400, 'invalid path filter');
    // Server-side filters: author/message are regex-compatible patterns,
    // since/until are ISO calendar dates. Invalid values are rejected rather
    // than silently ignored so the UI never shows misleading results.
    const author = validateFilterValue(query.get('author'));
    if (query.get('author') && !author) return fail(400, 'invalid author filter');
    const message = validateFilterValue(query.get('message'));
    if (query.get('message') && !message) return fail(400, 'invalid message filter');
    const since = validateDateValue(query.get('since'));
    if (query.get('since') && !since) return fail(400, 'invalid since date');
    const until = validateDateValue(query.get('until'));
    if (query.get('until') && !until) return fail(400, 'invalid until date');
    const filters = { author, message, since, until };
    try {
      const raw = await git(
        [
          'log',
          ...(scope === 'current' ? [] : ['--all']),
          '--date-order',
          `--max-count=${limit}`,
          ...(author ? [`--author=${author}`] : []),
          ...(message ? [`--grep=${message}`] : []),
          ...(since ? [`--since=${since}`] : []),
          ...(until ? [`--until=${until}`] : []),
          '--pretty=format:%H%x1f%P%x1f%an%x1f%ae%x1f%cI%x1f%s%x1f%b%x1e',
          ...(pathFilter ? ['--', pathFilter] : []),
        ],
        repo,
      );
      return ok({ commits: parseLog(raw), scope, path: pathFilter, filters });
    } catch (err) {
      return gitFail(err, 'git log failed');
    }
  }

  // Search the whole commit history (every reachable ref) instead of filtering
  // the current graph: a bare query greps the message, `author:x` the author
  // and `path:x` restricts to commits touching a path.
  if (pathname === '/api/search-commits' && method === 'GET') {
    const built = buildCommitSearch(query.get('q') || '', {
      limit: Number(query.get('limit')) || undefined,
    });
    if (!built) return fail(400, 'missing query');
    if ('error' in built) return fail(400, built.error);
    try {
      const raw = await git(built.args, repo);
      return ok({ commits: parseLog(raw), query: built.term, mode: built.mode });
    } catch (err) {
      return gitFail(err, 'git log failed');
    }
  }

  // Preview for the interactive-rebase dialog: the commits, plus the facts the
  // UI has to warn about (dirty tree, merge commits, already-pushed range).
  if (pathname === '/api/rebase/plan' && method === 'GET') {
    const base = normalizeRebaseBase(query.get('base'));
    if (!base) return fail(400, 'invalid rebase base');
    let commits;
    try {
      commits = await rebaseCommits(repo, base);
    } catch (err) {
      return gitFail(err, 'cannot list commits to rebase');
    }
    const guardrails = await rebaseGuardrails(repo, commits);
    return ok({ base, commits, ...guardrails });
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
    const ignoreWs = query.get('ignoreWs') === '1';
    const contextParam = query.get('context');
    let context = null;
    if (contextParam !== null) {
      const n = Number(contextParam);
      if (Number.isInteger(n) && n >= 0 && n <= 100) context = n;
    }
    // A file not yet in the index is invisible to plain `git diff`. Confirm
    // the untracked state explicitly, then diff against /dev/null so the
    // whole file is rendered as an addition.
    let isUntracked = false;
    try {
      const porcelain = await git(['status', '--porcelain', '--', rel], repo);
      isUntracked = porcelain.split('\n').some((l) => l.startsWith('?? '));
    } catch { /* fall through to the normal diff path */ }
    const args = ['diff'];
    if (isUntracked) {
      args.push('--no-index');
      if (ignoreWs) args.push('-w');
      if (context !== null) args.push(`--unified=${context}`);
      args.push('--', '/dev/null', rel);
    } else {
      if (staged) args.push('--cached');
      if (ignoreWs) args.push('-w');
      if (context !== null) args.push(`--unified=${context}`);
      args.push('--', rel);
    }
    try {
      let diff;
      try {
        diff = await git(args, repo);
      } catch (err) {
        // `git diff --no-index` exits 1 whenever the files differ; its stdout
        // is the valid diff. Any other failure propagates.
        if (isUntracked && err.code === 1) diff = err.stdout;
        else throw err;
      }
      let truncated = false;
      const lines = diff.split('\n');
      if (lines.length > DIFF_LINE_LIMIT) {
        diff = lines.slice(0, DIFF_LINE_LIMIT).join('\n');
        truncated = true;
      }
      return ok({ masked: false, path: rel, diff, truncated, untracked: isUntracked });
    } catch (err) {
      return gitFail(err, 'git diff failed');
    }
  }

  if (pathname === '/api/file' && method === 'GET') {
    const rel = normalizeRepoPath(query.get('file'));
    if (!rel) return fail(400, 'invalid file path');
    if (isSensitivePath(rel)) {
      return ok({ masked: true, path: rel, binary: false, content: '', truncated: false, ref: null, mtimeMs: null });
    }
    const refRaw = query.get('ref');
    const ref = refRaw ? validateRefSpec(refRaw) : null;
    if (refRaw && !ref) return fail(400, 'invalid ref');
    let content = '';
    let truncated = false;
    let mtimeMs = null;
    try {
      if (ref) {
        content = await git(['show', `${ref}:${rel}`], repo);
      } else {
        const resolved = await resolveInside(repo, rel);
        if (!resolved) return fail(403, 'path escapes repo root');
        const stat = await fsp.stat(resolved);
        if (!stat.isFile()) return fail(400, 'not a file');
        mtimeMs = stat.mtimeMs;
        if (stat.size > FILE_MAX_BYTES) {
          // Read only the cap instead of pulling a multi-hundred-MB file into
          // memory just to show a truncated preview.
          truncated = true;
          const handle = await fsp.open(resolved, 'r');
          try {
            const buffer = Buffer.alloc(FILE_MAX_BYTES);
            const { bytesRead } = await handle.read(buffer, 0, FILE_MAX_BYTES, 0);
            content = buffer.subarray(0, bytesRead).toString('utf8');
          } finally {
            await handle.close();
          }
        } else {
          content = await fsp.readFile(resolved, 'utf8');
        }
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
      mtimeMs,
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

  // Signature check for one commit. `%G?` is one letter per commit:
  // G good, B bad, U unknown validity, N no signature, E cannot be checked,
  // X expired, Y expired key, R revoked key.
  // Submodule states: " " up to date, "-" not initialized, "+" checked-out
  // commit differs from the index, "U" unresolved conflicts.
  // Bisect state: read from the marker files git itself maintains, so this
  // works even after a server restart. BISECT_LOG only exists mid-session.
  if (pathname === '/api/bisect' && method === 'GET') {
    return ok(await readBisectState(repo));
  }

  if (pathname === '/api/submodules' && method === 'GET') {
    try {
      const out = await git(['submodule', 'status', '--recursive'], repo);
      return ok({ entries: parseSubmoduleStatus(out) });
    } catch (err) {
      return gitFail(err, 'git submodule status failed');
    }
  }

  if (pathname === '/api/signature' && method === 'GET') {
    const sha = typeof query.get('sha') === 'string' ? query.get('sha').trim() : '';
    if (!/^[0-9a-f]{7,40}$/.test(sha)) return fail(400, 'invalid commit sha');
    try {
      const raw = await git(['log', '-1', '--format=%G?%x00%GS%x00%GK', sha], repo);
      const [status = '', signer = '', key = ''] = raw.replace(/\n$/, '').split('\u0000');
      return ok({
        sha,
        status: status.trim() || 'N',
        signer: signer.trim(),
        key: key.trim(),
        verified: status.trim() === 'G',
      });
    } catch (err) {
      return gitFail(err, 'git signature check failed');
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
        const target = numstatTarget(parts[parts.length - 1]);
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
    const ignoreWs = query.get('ignoreWs') === '1';
    try {
      // `-w` drops pure whitespace changes, matching the working-tree diff
      // toggle so the same review can be done with either view.
      const argv = ['show', '--format='];
      if (ignoreWs) argv.push('-w');
      argv.push(shaRaw, '--', file);
      const diff = await git(argv, repo);
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

  if (pathname === '/api/compare' && method === 'GET') {
    const base = validateCompareRef(query.get('base'));
    const head = validateCompareRef(query.get('head'));
    if (!base || !head) return fail(400, 'invalid base or head ref');
    if (base === head) return fail(400, 'base and head must differ');
    // The working tree owns no commits, so HEAD stands in for it in the log
    // ranges: against HEAD the commit lists are empty but the file diff is real.
    const logBase = base === COMPARE_WORKTREE ? 'HEAD' : base;
    const logHead = head === COMPARE_WORKTREE ? 'HEAD' : head;
    const sameTip = logBase === logHead;
    const worktree = base === COMPARE_WORKTREE || head === COMPARE_WORKTREE;
    // `git diff <ref>` compares that ref against the working tree; -R flips the
    // direction so the working tree can serve as the base side too.
    const diffRefs = worktree ? [base === COMPARE_WORKTREE ? head : base] : [base, head];
    const diffReverse = base === COMPARE_WORKTREE ? ['-R'] : [];
    const pretty = '--pretty=format:%H%x1f%P%x1f%an%x1f%ae%x1f%cI%x1f%s%x1f%b%x1e';
    try {
      const [aheadRaw, behindRaw, nameStatus, numstat, untrackedRaw] = await Promise.all([
        sameTip ? '' : git(['log', `${logBase}..${logHead}`, `--max-count=${LOG_LIMIT_MAX}`, pretty], repo),
        sameTip ? '' : git(['log', `${logHead}..${logBase}`, `--max-count=${LOG_LIMIT_MAX}`, pretty], repo),
        git(['diff', '--name-status', '-M', ...diffReverse, ...diffRefs], repo),
        git(['diff', '--numstat', '-M', ...diffReverse, ...diffRefs], repo),
        // Untracked files are invisible to `git diff` yet are part of the working
        // tree, so they are reported separately rather than implying a clean tree.
        worktree ? git(['ls-files', '--others', '--exclude-standard', '-z'], repo) : '',
      ]);
      const stats = new Map();
      for (const line of numstat.split('\n')) {
        if (!line) continue;
        const parts = line.split('\t');
        const target = numstatTarget(parts[parts.length - 1]);
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
        const filePath = isRename ? parts[2] : parts[1];
        const s = stats.get(filePath) || { additions: 0, deletions: 0 };
        files.push({
          status,
          path: filePath,
          renamedFrom: isRename ? parts[1] : null,
          additions: s.additions,
          deletions: s.deletions,
        });
      }
      return ok({
        base,
        head,
        ahead: parseLog(aheadRaw),
        behind: parseLog(behindRaw),
        files,
        untracked: untrackedRaw.split('\0').filter(Boolean),
      });
    } catch (err) {
      return gitFail(err, 'compare failed');
    }
  }

  if (pathname === '/api/grep' && method === 'GET') {
    const pattern = typeof query.get('pattern') === 'string' ? query.get('pattern') : '';
    if (!pattern) return fail(400, 'missing search pattern');
    if (pattern.includes('\0')) return fail(400, 'invalid pattern');
    const grepPath = query.get('path') ? normalizeRepoPath(query.get('path')) : null;
    if (query.get('path') && !grepPath) return fail(400, 'invalid search path');
    const ignoreCase = query.get('ignoreCase') === '1';
    const globParam = query.get('glob');
    const glob = globParam ? normalizeGrepGlob(globParam) : null;
    if (globParam && !glob) return fail(400, 'invalid glob filter');
    try {
      const paths = [];
      if (grepPath) paths.push(grepPath);
      if (glob) paths.push(glob);
      const raw = await git(grepArgv(pattern, { ignoreCase, paths }), repo);
      const matches = parseGrepLines(raw);
      return ok({ matches, truncated: false, total: matches.length });
    } catch (err) {
      // git grep exits 1 when nothing matches; treat that as an empty result.
      if (err && err.code === 1) return ok({ matches: [], total: 0, truncated: false });
      return gitFail(err, 'git grep failed');
    }
  }

  return null;
}
