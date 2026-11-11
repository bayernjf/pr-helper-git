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

export { parseGrepLines };

export async function handleGitMeta({ method, pathname, query, body, identity }) {
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

  // ---------- local data maintenance ----------
  // The settings page shows the config directory and its file sizes, and can
  // compact the audit log or drop registry entries whose paths have vanished.
  if (pathname === '/api/storage' && method === 'GET') {
    if (!identity || identity.role !== 'admin') return fail(403, 'admin access required');
    const { CONFIG_DIR, CONFIG_FILE, AUDIT_FILE } = configPaths();
    const files = [];
    for (const [name, file] of [['config.json', CONFIG_FILE], ['audit.log', AUDIT_FILE]]) {
      try {
        const st = await fsp.stat(file);
        files.push({ name, size: st.size });
      } catch {
        /* missing */
      }
    }
    return ok({ dataDir: CONFIG_DIR, files });
  }

  if (pathname === '/api/maintenance/audit-rotate' && method === 'POST') {
    if (!identity || identity.role !== 'admin') return fail(403, 'admin access required');
    await rotateAudit();
    await appendAudit({ action: 'audit-rotate' });
    return ok({ ok: true });
  }

  if (pathname === '/api/maintenance/prune-repos' && method === 'POST') {
    if (!identity || identity.role !== 'admin') return fail(403, 'admin access required');
    const result = await pruneRepos();
    reconcileWatching(result.repos);
    await appendAudit({ action: 'repos-prune', removed: result.removed });
    return ok({ ok: true, ...result });
  }

  // ---------- repository registry ----------

  if (pathname === '/api/repos' && method === 'GET') {
    const repos = await listRepos();
    const briefs = await mapLimit(repos, 4, repoBrief);
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

  // Raw file bytes for image diffs: ref omitted (or HEAD) + working-tree path.
  // GET /api/raw?repo=&path=&ref=  → binary body with a sniffed content type.
  if (pathname === '/api/raw' && method === 'GET') {
    const repo = typeof query.get('repo') === 'string' ? query.get('repo') : null;
    const rel = normalizeRepoPath(query.get('path') || '');
    if (!repo || !rel) return fail(400, 'invalid path');
    const ref = (query.get('ref') || 'HEAD').trim() || 'HEAD';
    if (!/^[0-9a-fA-F]{4,40}$/.test(ref) && ref !== 'HEAD') return fail(400, 'invalid ref');
    const registered = await listRepos();
    if (!registered.includes(repo)) return fail(403, 'unknown or unregistered repo');
    const abs = await resolveInside(repo, rel);
    const IMAGE_TYPES = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon', '.bmp': 'image/bmp',
    };
    const ext = path.extname(rel).toLowerCase();
    if (!IMAGE_TYPES[ext]) return fail(400, 'only image files are served raw');
    let bytes;
    try {
      bytes = await git(['show', `${ref}:${rel}`], repo, { encoding: 'buffer' });
    } catch {
      return fail(404, ref === 'HEAD' ? 'file not in HEAD' : 'not found in ref');
    }
    return { status: 200, raw: bytes, contentType: IMAGE_TYPES[ext] };
  }

  // Server-side GitHub PAT storage (parity with pr-helper-git's model):
  // the browser may keep no PAT at all — routes-github injects the stored
  // token into the proxy context. The value never round-trips to clients;
  // only its existence is reported.
  if (pathname === '/api/pat' && method === 'POST') {
    if (!isAdmin(identity)) return fail(403, 'admin access required');
    const pat = typeof body.pat === 'string' ? body.pat.trim() : '';
    if (!pat || pat.length > 255) return fail(400, 'invalid PAT');
    await updateConfig((config) => {
      config.github = { token: pat };
    });
    await appendAudit({ ok: true, action: 'pat.store' });
    return ok({ hasServerPat: true });
  }

  if (pathname === '/api/pat' && method === 'DELETE') {
    if (!isAdmin(identity)) return fail(403, 'admin access required');
    await updateConfig((config) => {
      delete config.github;
    });
    await appendAudit({ ok: true, action: 'pat.remove' });
    return ok({ hasServerPat: false });
  }

  if (pathname === '/api/pat/status' && method === 'GET') {
    const config = await loadConfig();
    return ok({ hasServerPat: Boolean(config.github?.token) });
  }

  if (pathname === '/api/repos/remove' && method === 'POST') {
    const target = typeof body.repo === 'string' ? body.repo : null;
    if (!target) return fail(400, 'invalid repository path');
    const repos = await removeRepo(target);
    stopWatching(target);
    await appendAudit({ action: 'repo-remove', repo: target });
    return ok({ repos });
  }

  // Reveal a repository in Finder / Terminal / a code editor (macOS `open`).
  // Parity with pr-helper-git's dashboard context menu.
  if (pathname === '/api/repos/open-external' && method === 'POST') {
    const target = typeof body.repo === 'string' ? body.repo : null;
    if (!target) return fail(400, 'invalid repository path');
    const registered = await listRepos();
    if (!registered.includes(target)) return fail(403, 'unknown or unregistered repo');
    const target2 = ['finder', 'terminal', 'editor'].includes(body.target) ? body.target : null;
    if (!target2) return fail(400, 'invalid target');
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const run = promisify(execFile);
    try {
      if (target2 === 'finder') await run('open', [target]);
      else if (target2 === 'terminal') await run('open', ['-a', 'Terminal', target]);
      else {
        try {
          await run('code', [target], { timeout: 5000 });
        } catch {
          try {
            await run('cursor', [target], { timeout: 5000 });
          } catch {
            await run('open', ['-a', 'Visual Studio Code', target], { timeout: 5000 });
          }
        }
      }
    } catch (err) {
      return fail(500, `open failed (${target2}): ${err?.message || err}`);
    }
    await appendAudit({ ok: true, action: `open-external.${target2}`, repo: target });
    return ok({ done: true });
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
    await appendAudit({ ok: true, action: 'repo-clone', repo: target, url: sanitizeUrlForAudit(url) });
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

  // ---------- team identity ----------

  if (pathname === '/api/me' && method === 'GET') {
    const current = identity || { name: 'owner', role: 'admin', instance: true };
    return ok({ name: current.name, role: current.role, instance: !!current.instance });
  }

  if (pathname === '/api/users') {
    if (!identity || identity.role !== 'admin') return fail(403, 'admin access required');
    if (method === 'GET') return ok(await listUsers());
    if (method === 'POST') {
      const created = await createUser(body.name, body.role || 'member');
      if ('error' in created) return fail(400, created.error);
      await appendAudit({ ok: true, action: 'user-create', target: created.user.name, role: created.user.role });
      // The plaintext token is returned once and never stored.
      return ok(created);
    }
    if (method === 'DELETE') {
      const removed = await removeUser(body.name);
      if ('error' in removed) return fail(400, removed.error);
      await appendAudit({ ok: true, action: 'user-remove', target: removed.name });
      return ok(removed);
    }
    return fail(405, 'method not allowed');
  }

  // Team configuration: the repository registry plus the (non-secret) member
  // list. Tokens are never exported. Import only accepts repositories that are
  // real Git working trees on this machine.
  if (pathname === '/api/team/config') {
    if (!identity || identity.role !== 'admin') return fail(403, 'admin access required');
    if (method === 'GET') {
      const config = await loadConfig();
      const team = await listUsers();
      return ok({
        version: 1,
        exportedAt: new Date().toISOString(),
        repos: config.repos,
        owner: team.owner.name,
        members: team.users.map((u) => ({ name: u.name, role: u.role })),
      });
    }
    if (method === 'POST') {
      if (!Array.isArray(body.repos)) return fail(400, 'repos must be an array');
      if (body.repos.length > 200) return fail(400, 'too many repositories (max 200)');
      const accepted = [];
      for (const candidate of body.repos) {
        if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) continue;
        try {
          await fsp.stat(path.join(candidate, '.git'));
          accepted.push(candidate);
        } catch { /* not a Git working tree; skip */ }
      }
      if (!accepted.length) return fail(400, 'no valid repositories in the file');
      const imported = await updateConfig((config) => {
        config.repos = body.mode === 'merge'
          ? [...new Set([...config.repos, ...accepted])].sort()
          : [...new Set(accepted)].sort();
        return config.repos;
      });
      reconcileWatching(imported);
      await appendAudit({ ok: true, action: 'team-config-import', repos: imported.length });
      return ok({ ok: true, repos: imported, imported: accepted.length });
    }
    return fail(405, 'method not allowed');
  }

  // ---------- AI settings (instance-wide, no repo required) ----------

  if (pathname === '/api/ai/config') {
    if (method === 'GET') return ok(publicAiConfig(await loadAiConfig()));
    if (method === 'POST') {
      if (!isAdmin(identity)) return fail(403, 'admin access required');
      const current = await loadAiConfig();
      const next = normalizeAiConfig(body, current);
      const error = validateAiConfig(next);
      if (error) return fail(400, error);
      await saveAiConfig(next);
      await appendAudit({ ok: true, action: 'ai-config', configured: isAiConfigured(next) });
      return ok(publicAiConfig(next));
    }
    return fail(405, 'method not allowed');
  }

  if (pathname === '/api/ai/test') {
    if (method !== 'POST') return fail(405, 'method not allowed');
    if (!isAdmin(identity)) return fail(403, 'admin access required');
    const ai = await loadAiConfig();
    if (!isAiConfigured(ai)) return fail(400, 'AI is not configured');
    try {
      const reply = await complete('Reply with the single word OK.', { temperature: 0 });
      await appendAudit({ ok: true, action: 'ai-test' });
      return ok({ ok: true, reply: reply.slice(0, 200) });
    } catch (err) {
      await appendAudit({ ok: false, action: 'ai-test' });
      return fail(502, 'AI test failed', err.message);
    }
  }

  // GitHub-specific endpoints are handled by routes-github.mjs and do not
  // carry a repo field the same way; let them fall through before the
  // generic registered-repo guard below.
  if (pathname === '/api/github' || pathname === '/api/remote') return null;


  return null;
}
