// Git API routes. Every handler returns { status, json } or null when the
// route does not match. Write actions use fixed argv arrays and are audited.
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

export const DIFF_LINE_LIMIT = 2000;
export const SAVE_MAX_BYTES = 1024 * 1024; // matches the 1 MB file viewer cap
export const LOG_LIMIT_DEFAULT = 200;
export const LOG_LIMIT_MAX = 1000;
// A rebase replays commits one by one, so it needs far more head-room than a
// single git call.
export const REBASE_TIMEOUT_MS = 120000;
export const FILE_MAX_BYTES = 1_000_000;
// Network operations routinely take longer than a local git command; a 20s
// cap would kill a slow fetch/pull/push mid-flight.
export const NETWORK_TIMEOUT_MS = 120_000;

// Whitelist of git config keys that may be viewed or edited from the GUI.
// Arbitrary keys are rejected because some (core.sshCommand, alias.*,
// include.*, core.fsmonitor, core.gitProxy, ...) can execute commands or
// escape the repository. All writes target the repository-local config.
export const CONFIG_SPECS = [
  { key: 'user.name', type: 'text' },
  { key: 'user.email', type: 'email' },
  { key: 'init.defaultBranch', type: 'branch' },
  { key: 'core.autocrlf', type: 'enum', options: ['true', 'false', 'input'] },
  { key: 'pull.rebase', type: 'enum', options: ['true', 'false', 'merges'] },
  { key: 'push.default', type: 'enum', options: ['nothing', 'matching', 'upstream', 'simple', 'current'] },
  { key: 'merge.conflictstyle', type: 'enum', options: ['merge', 'diff3', 'zdiff3'] },
];
export const CONFIG_SPEC_BY_KEY = new Map(CONFIG_SPECS.map((spec) => [spec.key, spec]));
export const CONFIG_VALUE_MAX = 256;

// Accept a commit SHA or an ordinary ref/branch/tag name (option-like and
// traversal values are rejected). Used to read a blob at a specific ref.
export function validateRefSpec(raw) {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (!v || v.startsWith('-') || v.includes('..') || v.includes('\0')) return null;
  if (/^[0-9a-f]{7,40}$/.test(v)) return v;
  return validateRefName(v) ? v : null;
}

/** Resolve a path inside the repository's own git dir (BISECT_LOG, BISECT_START). */
export async function gitDirPath(repo, name) {
  const rel = (await git(['rev-parse', '--git-path', name], repo)).trim();
  return path.isAbsolute(rel) ? rel : path.resolve(repo, rel);
}

export async function readBisectState(repo) {
  let log = '';
  try {
    log = await fsp.readFile(await gitDirPath(repo, 'BISECT_LOG'), 'utf8');
  } catch {
    return { active: false, start: null, current: null, log: '', decisions: { good: 0, bad: 0 } };
  }
  let start = null;
  try {
    start = (await fsp.readFile(await gitDirPath(repo, 'BISECT_START'), 'utf8')).trim() || null;
  } catch {
    start = null;
  }
  let current = null;
  try {
    const raw = await git(['log', '-1', '--format=%H%x00%s'], repo);
    const [sha = '', subject = ''] = raw.replace(/\n$/, '').split('\u0000');
    if (sha.trim()) current = { sha: sha.trim(), subject: subject.trim() };
  } catch {
    current = null;
  }
  const good = (log.match(/^# good:/gm) || []).length;
  const bad = (log.match(/^# bad:/gm) || []).length;
  return { active: true, start, current, log, decisions: { good, bad } };
}

export const isAdmin = (identity) => Boolean(identity && identity.role === 'admin');

// Enumerate paths that a bulk write would touch. NUL-separated output keeps
// paths with spaces/newlines intact.
export async function changedPaths(repo, { stagedOnly = false } = {}) {
  const commands = stagedOnly
    ? [['diff', '--cached', '--name-only', '-z']]
    : [
      ['diff', '--name-only', '-z'],
      ['diff', '--cached', '--name-only', '-z'],
      ['ls-files', '--others', '--exclude-standard', '-z'],
    ];
  const paths = [];
  for (const argv of commands) {
    const raw = await git(argv, repo).catch((err) => {
      if (err && err.code === 1) return '';
      throw err;
    });
    for (const p of raw.split('\0')) if (p) paths.push(p);
  }
  return [...new Set(paths)];
}

export async function sensitiveChanges(repo, options = {}) {
  return (await changedPaths(repo, options)).filter(isSensitivePath);
}

export function sensitiveFail(paths, action) {
  return fail(
    409,
    `sensitive files cannot be ${action}; unstage or add them to .gitignore first`,
    paths.join(', '),
  );
}

// Bound fan-out for per-repo git work: the registry allows hundreds of repos,
// and each brief spawns at least two git processes.
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export function gitFail(err, fallback) {
  return fail(400, fallback, err.stderr || err.message);
}

// Parse NUL-separated `git grep -n -z` output into path/line/text records.
// Git emits `path\0line\0text\n` per match, so the next record's path follows
// the text directly — splitting on NUL alone would misalign every record after
// the first. The regex stops at the line's newline, keeps a path containing
// ':' intact, and tolerates an empty matched line.
export function parseGrepLines(raw) {
  const out = [];
  const record = /([^\0]*)\0(\d+)\0([^\r\n]*)\r?\n?/g;
  let m;
  while ((m = record.exec(String(raw || ''))) !== null) {
    const [, file, lineText, text] = m;
    const line = Number(lineText);
    if (!file || !Number.isInteger(line) || line < 1) continue;
    out.push({ path: file, line, text });
  }
  return out;
}

// Build a `git grep` argv from the optional case-insensitive flag and file
// glob. The pattern is passed with -e so a value starting with "-" is not read
// as an option; pathspecs follow "--" for the same reason.
export function grepArgv(pattern, { ignoreCase = false, paths = [] } = {}) {
  const argv = ['grep', '-I', '-n', '-z', '--untracked'];
  if (ignoreCase) argv.push('-i');
  argv.push('-e', pattern, '--');
  for (const p of paths) argv.push(p);
  return argv;
}

// A glob filter is a single git pathspec: reject separators that would let one
// value inject extra pathspecs, and treat a leading "-" as invalid.
export function normalizeGrepGlob(value) {
  if (typeof value !== 'string') return null;
  const glob = value.trim();
  if (!glob || glob.length > 200) return null;
  if (/[\0\r\n]/.test(glob) || glob.startsWith('-')) return null;
  return `:(glob)${glob}`;
}

// Parse `git config --list` output ("key=value") into a map. Later entries
// override earlier ones, and git lists system then global then local, so the
// final value is the effective one.
export function parseConfigList(raw) {
  const out = {};
  for (const line of raw.split('\n')) {
    if (!line) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

// Resolve a user-supplied parent directory and confirm it exists.
export async function resolveParentDir(raw) {
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

export async function findRegistered(repoArg) {
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

export async function repoBrief(absPath) {
  const brief = {
    path: absPath,
    name: path.basename(absPath),
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    unmerged: 0,
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
      else if (f.area === 'unmerged') brief.unmerged += 1;
      else if (f.area === 'unstaged') brief.unstaged += 1;
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

export function validateStashIndex(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 99 ? n : null;
}

// ---------- interactive rebase helpers ----------

/**
 * A rebase base is either the literal "root" (rewrite the whole branch) or a
 * revision. The pattern rejects anything that could be read as an option.
 */
export function normalizeRebaseBase(raw) {
  const value = String(raw ?? '').trim();
  if (value === 'root') return 'root';
  if (!/^[0-9A-Za-z._/-]{1,120}$/.test(value)) return null;
  if (value.startsWith('-')) return null;
  return value;
}

/** Commits a `rebase -i <base>` would list, oldest first. */
export async function rebaseCommits(repo, base) {
  const args = [
    'log',
    '--reverse',
    '--date-order',
    '--pretty=format:%H%x1f%P%x1f%an%x1f%ae%x1f%cI%x1f%s%x1f%b%x1e',
  ];
  args.push(base === 'root' ? 'HEAD' : `${base}..HEAD`);
  return parseLog(await git(args, repo));
}

/** Conditions the UI must show before rewriting history. */
export async function rebaseGuardrails(repo, commits) {
  const dirty = (await git(['status', '--porcelain'], repo)).trim().length > 0;
  const merges = commits.filter((c) => c.parents.length > 1).map((c) => c.hash.slice(0, 7));
  let upstream = null;
  let pushed = false;
  try {
    upstream = (await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], repo)).trim() || null;
  } catch { /* no upstream configured */ }
  if (upstream && commits.length) {
    try {
      // The oldest commit already living on the remote means the whole range is
      // published; rewriting it would require a force-push.
      await git(['merge-base', '--is-ancestor', commits[0].hash, upstream], repo);
      pushed = true;
    } catch { /* range is still local */ }
  }
  return { dirty, merges, upstream, pushed };
}

// Detect in-progress multi-step operations. A standard repository has a .git
// directory; worktrees (out of scope) replace it with a file and are skipped.
export async function detectRepoState(absRepo) {
  const state = {
    mergeInProgress: false,
    rebaseInProgress: false,
    rebaseType: null,
    revertInProgress: false,
  };
  const gitDir = path.join(absRepo, '.git');
  try {
    const stat = await fsp.stat(gitDir);
    if (!stat.isDirectory()) return state;
  } catch {
    return state;
  }
  try {
    await fsp.access(path.join(gitDir, 'MERGE_HEAD'));
    state.mergeInProgress = true;
  } catch { /* no merge in progress */ }
  // A conflicting revert leaves REVERT_HEAD behind until --continue/--abort.
  try {
    await fsp.access(path.join(gitDir, 'REVERT_HEAD'));
    state.revertInProgress = true;
  } catch { /* no revert in progress */ }
  try {
    await fsp.access(path.join(gitDir, 'rebase-merge'));
    state.rebaseInProgress = true;
    state.rebaseType = 'merge';
  } catch {
    try {
      await fsp.access(path.join(gitDir, 'rebase-apply'));
      state.rebaseInProgress = true;
      state.rebaseType = 'apply';
    } catch { /* no rebase in progress */ }
  }
  return state;
}

// Paths git still reports as conflicted. Used to tell the UI whether "continue"
// is possible and to name the files the user has to resolve.
export async function unmergedPaths(repo) {
  try {
    return (await git(['diff', '--name-only', '--diff-filter=U'], repo))
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Free-text filter values are always joined with "=" so they can never be
// parsed as options; NUL bytes and oversized values are still rejected.
export function validateFilterValue(raw, max = 200) {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (!v || v.includes('\0') || v.length > max) return null;
  return v;
}

// Only calendar dates are accepted for since/until (ISO 8601 date or
// date-time); relative git dates are deliberately not exposed.
export function validateDateValue(raw) {
  if (raw === null) return null;
  const v = String(raw).trim();
  if (!v) return null;
  return /^\d{4}-\d{2}-\d{2}(?:T[\d:.Z+-]+)?$/.test(v) ? v : null;
}

