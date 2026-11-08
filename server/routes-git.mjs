// Git API routes. Every handler returns { status, json } or null when the
// route does not match. Write actions use fixed argv arrays and are audited.
import fsp from 'node:fs/promises';
import path from 'node:path';
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
  parseTagObject,
  splitFilePatch,
} from './git.mjs';
import {
  isSensitivePath,
  normalizeRepoPath,
  resolveInside,
  validateCloneUrl,
  validateFolderName,
  validateRefName,
} from './security.mjs';
import {
  addRepo,
  appendAudit,
  listRepos,
  readAudit,
  removeRepo,
} from './store.mjs';
import { ensureWatching, stopWatching } from './watcher.mjs';

const DIFF_LINE_LIMIT = 2000;
const SAVE_MAX_BYTES = 1024 * 1024; // matches the 1 MB file viewer cap
const LOG_LIMIT_DEFAULT = 200;
const LOG_LIMIT_MAX = 1000;
const FILE_MAX_BYTES = 1_000_000;
// Network operations routinely take longer than a local git command; a 20s
// cap would kill a slow fetch/pull/push mid-flight.
const NETWORK_TIMEOUT_MS = 120_000;

// Whitelist of git config keys that may be viewed or edited from the GUI.
// Arbitrary keys are rejected because some (core.sshCommand, alias.*,
// include.*, core.fsmonitor, core.gitProxy, ...) can execute commands or
// escape the repository. All writes target the repository-local config.
const CONFIG_SPECS = [
  { key: 'user.name', type: 'text' },
  { key: 'user.email', type: 'email' },
  { key: 'init.defaultBranch', type: 'branch' },
  { key: 'core.autocrlf', type: 'enum', options: ['true', 'false', 'input'] },
  { key: 'pull.rebase', type: 'enum', options: ['true', 'false', 'merges'] },
  { key: 'push.default', type: 'enum', options: ['nothing', 'matching', 'upstream', 'simple', 'current'] },
  { key: 'merge.conflictstyle', type: 'enum', options: ['merge', 'diff3', 'zdiff3'] },
];
const CONFIG_SPEC_BY_KEY = new Map(CONFIG_SPECS.map((spec) => [spec.key, spec]));
const CONFIG_VALUE_MAX = 256;

// Accept a commit SHA or an ordinary ref/branch/tag name (option-like and
// traversal values are rejected). Used to read a blob at a specific ref.
function validateRefSpec(raw) {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (!v || v.startsWith('-') || v.includes('..') || v.includes('\0')) return null;
  if (/^[0-9a-f]{7,40}$/.test(v)) return v;
  return validateRefName(v) ? v : null;
}

const ok = (json) => ({ status: 200, json });
const fail = (status, error, detail) => ({ status, json: { error, ...(detail ? { detail } : {}) } });

function gitFail(err, fallback) {
  return fail(400, fallback, err.stderr || err.message);
}

// Parse `git grep -n` output lines ("path:line:text") into structured matches.
// Parse NUL-separated `git grep -n -z` output into path/line/text triples.
// The NUL separators keep file names that contain ':' (legal on macOS and
// Linux) intact; the previous "path:line:text" split truncated them.
function parseGrepLines(raw) {
  const parts = raw.split('\0');
  const out = [];
  for (let i = 0; i + 2 < parts.length; i += 3) {
    if (!parts[i]) continue;
    out.push({
      path: parts[i],
      line: Number(parts[i + 1]),
      // With -z the record keeps the line's trailing newline before the NUL.
      text: parts[i + 2].replace(/\r?\n$/, ''),
    });
  }
  return out;
}

// Build a `git grep` argv from the optional case-insensitive flag and file
// glob. The pattern is passed with -e so a value starting with "-" is not read
// as an option; pathspecs follow "--" for the same reason.
function grepArgv(pattern, { ignoreCase = false, paths = [] } = {}) {
  const argv = ['grep', '-I', '-n', '-z', '--untracked'];
  if (ignoreCase) argv.push('-i');
  argv.push('-e', pattern, '--');
  for (const p of paths) argv.push(p);
  return argv;
}

// A glob filter is a single git pathspec: reject separators that would let one
// value inject extra pathspecs, and treat a leading "-" as invalid.
function normalizeGrepGlob(value) {
  if (typeof value !== 'string') return null;
  const glob = value.trim();
  if (!glob || glob.length > 200) return null;
  if (/[\0\r\n]/.test(glob) || glob.startsWith('-')) return null;
  return `:(glob)${glob}`;
}

// Parse `git config --list` output ("key=value") into a map. Later entries
// override earlier ones, and git lists system then global then local, so the
// final value is the effective one.
function parseConfigList(raw) {
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
async function resolveParentDir(raw) {
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

async function findRegistered(repoArg) {
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

async function repoBrief(absPath) {
  const brief = {
    path: absPath,
    name: path.basename(absPath),
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
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
      else if (f.area === 'unstaged' || f.area === 'unmerged') brief.unstaged += 1;
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

function validateStashIndex(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 99 ? n : null;
}

// Detect in-progress multi-step operations. A standard repository has a .git
// directory; worktrees (out of scope) replace it with a file and are skipped.
async function detectRepoState(absRepo) {
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
async function unmergedPaths(repo) {
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
function validateFilterValue(raw, max = 200) {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (!v || v.includes('\0') || v.length > max) return null;
  return v;
}

// Only calendar dates are accepted for since/until (ISO 8601 date or
// date-time); relative git dates are deliberately not exposed.
function validateDateValue(raw) {
  if (raw === null) return null;
  const v = String(raw).trim();
  if (!v) return null;
  return /^\d{4}-\d{2}-\d{2}(?:T[\d:.Z+-]+)?$/.test(v) ? v : null;
}

export async function handleGitRoute({ method, pathname, query, body }) {
  if (pathname === '/api/health' && method === 'GET') {
    return ok({ ok: true });
  }

  // Read-only audit trail. The limit is bounded in the store; an explicitly
  // non-numeric value is rejected here so callers notice the mistake. The
  // q/outcome filters are validated here and applied in the store over the
  // whole retained file, not just the returned window.
  if (pathname === '/api/audit' && method === 'GET') {
    let limit = 200;
    const rawLimit = query.get('limit');
    if (rawLimit !== null) {
      if (!/^\d{1,4}$/.test(rawLimit)) return fail(400, 'invalid audit limit');
      limit = Number(rawLimit);
    }
    const filters = {};
    const q = query.get('q');
    if (q !== null) {
      const trimmed = q.trim();
      if (trimmed.length > 100) return fail(400, 'audit query too long');
      if (trimmed) filters.q = trimmed;
    }
    const outcome = query.get('outcome');
    if (outcome !== null) {
      if (!['all', 'ok', 'fail'].includes(outcome)) return fail(400, 'invalid audit outcome');
      if (outcome !== 'all') filters.outcome = outcome;
    }
    const result = await readAudit(limit, filters);
    return ok({ collectedAt: new Date().toISOString(), ...result });
  }

  // ---------- repository registry ----------

  if (pathname === '/api/repos' && method === 'GET') {
    const repos = await listRepos();
    const briefs = await Promise.all(repos.map(repoBrief));
    return ok({ collectedAt: new Date().toISOString(), repos: briefs });
  }

  if (pathname === '/api/repos/add' && method === 'POST') {
    const target = typeof body.repo === 'string' ? path.resolve(body.repo) : null;
    if (!target) return fail(400, 'repo must be a string path');
    try {
      await fsp.stat(path.join(target, '.git'));
    } catch {
      return fail(400, 'not a git repository (missing .git)');
    }
    const repos = await addRepo(target);
    await appendAudit({ action: 'repo-add', repo: target });
    ensureWatching(target);
    // Return the resolved path so the client can select exactly this repo even
    // when the typed path had a trailing slash or a relative segment.
    return ok({ repos, path: target });
  }

  if (pathname === '/api/repos/remove' && method === 'POST') {
    const target = typeof body.repo === 'string' ? body.repo : null;
    if (!target) return fail(400, 'invalid repository path');
    const repos = await removeRepo(target);
    stopWatching(target);
    await appendAudit({ action: 'repo-remove', repo: target });
    return ok({ repos });
  }

  if (pathname === '/api/repos/pull' && method === 'POST') {
    // Batch pull for the multi-repository panel. Only registered repositories
    // are accepted, and --ff-only is used so a diverged branch fails cleanly
    // instead of opening a merge in a repository the user is not looking at.
    const requested = Array.isArray(body.repos)
      ? [...new Set(body.repos.filter((p) => typeof p === 'string'))]
      : [];
    const registered = await listRepos();
    const targets = requested.filter((p) => registered.includes(p)).slice(0, 50);
    if (!targets.length) return fail(400, 'no registered repositories selected');
    const results = [];
    for (const target of targets) {
      try {
        const out = await git(['pull', '--ff-only'], target, { timeout: NETWORK_TIMEOUT_MS });
        await appendAudit({ ok: true, action: 'repos-pull', repo: target });
        results.push({ repo: target, ok: true, result: out.trim().slice(0, 300) });
      } catch (err) {
        await appendAudit({ ok: false, action: 'repos-pull', repo: target });
        results.push({ repo: target, ok: false, error: String(err.stderr || err.message || '').slice(0, 300) });
      }
    }
    const failCount = results.filter((r) => !r.ok).length;
    return ok({ results, okCount: results.length - failCount, failCount });
  }

  if (pathname === '/api/repos/clone' && method === 'POST') {
    const url = validateCloneUrl(body.url) ? body.url.trim() : null;
    const name = validateFolderName(body.name);
    if (!url) return fail(400, 'invalid or unsupported clone URL');
    if (!name) return fail(400, 'invalid destination folder name');
    const parent = await resolveParentDir(body.parentDir);
    if (!parent) return fail(400, 'parent directory does not exist');
    const target = path.join(parent, name);
    try {
      await fsp.stat(target);
      return fail(409, 'destination already exists');
    } catch { /* expected: target must not exist */ }
    try {
      await git(['clone', '--', url, target], process.cwd(), { timeout: 120_000 });
    } catch (err) {
      return gitFail(err, 'git clone failed');
    }
    const repos = await addRepo(target);
    ensureWatching(target);
    await appendAudit({ ok: true, action: 'repo-clone', repo: target, url });
    return ok({ repos, path: target });
  }

  if (pathname === '/api/repos/init' && method === 'POST') {
    if (typeof body.path !== 'string' || !body.path.trim()) {
      return fail(400, 'path must be a string');
    }
    const target = path.resolve(body.path.trim());
    if (target === path.parse(target).root) return fail(400, 'refusing to initialise a filesystem root');
    const parent = await resolveParentDir(path.dirname(target));
    if (!parent) return fail(400, 'parent directory does not exist');
    let exists = false;
    try {
      const stat = await fsp.stat(target);
      if (!stat.isDirectory()) return fail(400, 'path exists and is not a directory');
      exists = true;
      try {
        await fsp.stat(path.join(target, '.git'));
        return fail(409, 'already a git repository');
      } catch { /* no .git yet */ }
    } catch {
      await fsp.mkdir(target);
    }
    try {
      await git(['init'], target);
    } catch (err) {
      return gitFail(err, 'git init failed');
    }
    const repos = await addRepo(target);
    ensureWatching(target);
    await appendAudit({ ok: true, action: 'repo-init', repo: target, preExisting: exists });
    return ok({ repos, path: target });
  }

  // Search the same pattern across every registered repository. A failure in
  // one repo (no match, missing work tree, etc.) is reported for that repo
  // instead of failing the whole aggregation.
  if (pathname === '/api/grep-all' && method === 'GET') {
    const pattern = typeof query.get('pattern') === 'string' ? query.get('pattern') : '';
    if (!pattern) return fail(400, 'missing search pattern');
    if (pattern.includes('\0')) return fail(400, 'invalid pattern');
    const ignoreCase = query.get('ignoreCase') === '1';
    const globParam = query.get('glob');
    const glob = globParam ? normalizeGrepGlob(globParam) : null;
    if (globParam && !glob) return fail(400, 'invalid glob filter');
    const GLOBAL_MATCH_CAP = 500;
    const registered = await listRepos();
    const results = [];
    let budget = GLOBAL_MATCH_CAP;
    let truncated = false;
    for (const repo of registered) {
      let matches;
      try {
        const raw = await git(grepArgv(pattern, { ignoreCase, paths: glob ? [glob] : [] }), repo);
        matches = parseGrepLines(raw);
      } catch (err) {
        // git grep exits 1 when nothing matches; other errors are isolated.
        if (err && err.code === 1) {
          matches = [];
        } else {
          results.push({ repo, name: path.basename(repo), matches: [], error: err.stderr || err.message });
          continue;
        }
      }
      if (matches.length > budget) {
        matches = matches.slice(0, budget);
        truncated = true;
      }
      budget -= matches.length;
      results.push({ repo, name: path.basename(repo), matches });
      if (budget <= 0) {
        truncated = true;
        break;
      }
    }
    const total = results.reduce((sum, r) => sum + r.matches.length, 0);
    return ok({ pattern, results, total, truncated, limit: GLOBAL_MATCH_CAP });
  }

  // GitHub-specific endpoints are handled by routes-github.mjs and do not
  // carry a repo field the same way; let them fall through before the
  // generic registered-repo guard below.
  if (pathname === '/api/github' || pathname === '/api/remote') return null;

  // All remaining routes operate on a registered repo.
  const repo = await findRegistered(method === 'GET' ? query.get('repo') : body.repo);
  if (!repo) return fail(403, 'unknown or unregistered repo');

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
      const text = await fsp.readFile(resolved, 'utf8');
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
    const base = validateRefSpec(query.get('base'));
    const head = validateRefSpec(query.get('head'));
    if (!base || !head) return fail(400, 'invalid base or head ref');
    if (base === head) return fail(400, 'base and head must differ');
    const pretty = '--pretty=format:%H%x1f%P%x1f%an%x1f%ae%x1f%cI%x1f%s%x1f%b%x1e';
    try {
      const [aheadRaw, behindRaw, nameStatus, numstat] = await Promise.all([
        git(['log', `${base}..${head}`, `--max-count=${LOG_LIMIT_MAX}`, pretty], repo),
        git(['log', `${head}..${base}`, `--max-count=${LOG_LIMIT_MAX}`, pretty], repo),
        git(['diff', '--name-status', '-M', base, head], repo),
        git(['diff', '--numstat', '-M', base, head], repo),
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

  if (method !== 'POST') return null;

  // ---------- writes ----------

  if (pathname === '/api/stage') {
    const action = body.action === 'unstage' ? 'unstage' : body.action === 'stage' ? 'stage' : null;
    if (!action) return fail(400, 'action must be "stage" or "unstage"');
    const rel = normalizeRepoPath(body.file);
    if (!rel) return fail(400, 'invalid file path');
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
      const staged = await git(['diff', '--cached', '--name-only'], repo);
      if (!staged.trim() && !allowEmpty) return fail(409, 'nothing staged to commit');
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
    if (body.dryRun === true) {
      try {
        const out = await git(['clean', '-nd'], repo);
        const paths = out.split('\n')
          .filter((l) => l.startsWith('Would remove '))
          .map((l) => l.slice('Would remove '.length));
        return ok({ dryRun: true, paths });
      } catch (err) {
        return gitFail(err, 'git clean dry-run failed');
      }
    }
    if (body.confirm !== true) return fail(400, 'clean requires confirmation');
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
