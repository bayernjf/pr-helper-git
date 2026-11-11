// Persistent local state: registered repository list and the audit trail.
// Nothing leaves this machine; the config lives under ~/.pr-helper-git2.
import fsp from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { currentActor } from './actor.mjs';

// The home override exists so tests can run against an isolated registry and
// audit trail without touching the user's real ~/.pr-helper-git2 directory.
const CONFIG_DIR = process.env.PR_HELPER_HOME
  ? path.resolve(process.env.PR_HELPER_HOME)
  : path.join(os.homedir(), '.pr-helper-git2');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const AUDIT_FILE = path.join(CONFIG_DIR, 'audit.log');

// Retention policy. The audit trail is appended to on every local operation,
// so once it crosses the trigger size it is rewritten to the smaller target
// budget, keeping only the newest valid entries. Rotation runs only after a
// threshold crossing, not on every write.
export const AUDIT_ROTATE_BYTES = 1.5 * 1024 * 1024;
export const AUDIT_TARGET_BYTES = 1024 * 1024;
export const AUDIT_KEEP_ENTRIES = 10000;

export function configPaths() {
  return { CONFIG_DIR, CONFIG_FILE, AUDIT_FILE };
}

// All config writes run through one promise chain. Each operation reads,
// mutates and writes while holding the chain, so two concurrent requests can
// no longer overwrite each other's changes.
let writeChain = Promise.resolve();
let tmpCounter = 0;

function serializeWrite(task) {
  const run = writeChain.then(task, task);
  writeChain = run.catch(() => {});
  return run;
}

async function ensureConfigDir() {
  await fsp.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  // `mode` only applies on creation; tighten an existing directory too.
  await fsp.chmod(CONFIG_DIR, 0o700).catch(() => {});
}

async function writeConfigAtomic(config) {
  await ensureConfigDir();
  const tmp = `${CONFIG_FILE}.${process.pid}.${++tmpCounter}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });
  await fsp.chmod(tmp, 0o600).catch(() => {});
  await fsp.rename(tmp, CONFIG_FILE);
  await fsp.chmod(CONFIG_FILE, 0o600).catch(() => {});
}

/** Tighten permissions on the data dir and existing files at startup. */
export async function ensureDataPermissions() {
  await ensureConfigDir();
  for (const file of [CONFIG_FILE, AUDIT_FILE]) {
    await fsp.chmod(file, 0o600).catch(() => {});
  }
}

export async function loadConfig() {
  let raw;
  try {
    raw = await fsp.readFile(CONFIG_FILE, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { repos: [], users: [] };
    throw err;
  }
  try {
    const parsed = JSON.parse(raw);
    // Keep unknown top-level fields (users, ownerName, future settings) so a
    // repo add/remove never drops team identity data.
    return {
      ...parsed,
      repos: Array.isArray(parsed.repos) ? parsed.repos : [],
      users: Array.isArray(parsed.users) ? parsed.users : [],
    };
  } catch (err) {
    // Never silently replace a corrupt config with an empty one: move it aside
    // first so the user can recover PAT/AI/user data by hand.
    const backup = `${CONFIG_FILE}.corrupt-${Date.now()}`;
    await fsp.rename(CONFIG_FILE, backup).catch(() => {});
    console.error(`config parse failed; moved to ${backup}: ${err.message}`);
    return { repos: [], users: [] };
  }
}

/**
 * Read-modify-write under the write chain. A mutator may return
 * `{ value, persist: false }` to skip the write (validation failures).
 * @param {(config: any) => any} mutator
 * @returns {Promise<any>}
 */
export async function updateConfig(mutator) {
  return serializeWrite(async () => {
    const config = await loadConfig();
    const outcome = await mutator(config);
    if (!outcome || outcome.persist !== false) await writeConfigAtomic(config);
    return outcome && Object.prototype.hasOwnProperty.call(outcome, 'value')
      ? outcome.value
      : outcome;
  });
}

export async function listRepos() {
  return (await loadConfig()).repos;
}

export async function addRepo(absPath) {
  return updateConfig((config) => {
    if (config.repos.includes(absPath)) return config.repos;
    config.repos.push(absPath);
    config.repos.sort();
    return config.repos;
  });
}

export async function removeRepo(absPath) {
  return updateConfig((config) => {
    config.repos = config.repos.filter((p) => p !== absPath);
    return config.repos;
  });
}

/**
 * Drop registry entries whose paths no longer exist or are no longer Git.
 * @returns {Promise<{removed: number, total: number, removedPaths: string[], repos: string[]}>}
 */
export async function pruneRepos() {
  return updateConfig(async (config) => {
    const alive = [];
    const removedPaths = [];
    for (const repo of config.repos) {
      try {
        const st = await fsp.stat(path.join(repo, '.git'));
        if (st.isFile() || st.isDirectory()) alive.push(repo);
        else removedPaths.push(repo);
      } catch {
        removedPaths.push(repo);
      }
    }
    if (!removedPaths.length) {
      return {
        persist: false,
        value: { removed: 0, total: alive.length, removedPaths, repos: alive },
      };
    }
    config.repos = alive;
    return { value: { removed: removedPaths.length, total: alive.length, removedPaths, repos: alive } };
  });
}

export async function appendAudit(entry) {
  // Attribute every entry to the authenticated member of the current request.
  // currentActor() is null outside a request (for example tests calling this
  // directly), in which case no user field is written.
  const actor = currentActor();
  const line = `${JSON.stringify({
    at: new Date().toISOString(),
    ...(actor ? { user: actor.name, role: actor.role } : {}),
    ...entry,
  })}\n`;
  try {
    await ensureConfigDir();
    await fsp.appendFile(AUDIT_FILE, line, { mode: 0o600 });
    await fsp.chmod(AUDIT_FILE, 0o600).catch(() => {});
    const stat = await fsp.stat(AUDIT_FILE);
    if (stat.size > AUDIT_ROTATE_BYTES) await rotateAudit();
  } catch (err) {
    // Audit failure must not crash the request; surface it on stderr.
    console.error(`audit write failed: ${err.message}`);
  }
}

// Rewrite the audit file keeping the newest entries that fit the byte budget
// and the entry-count cap. Walking newest-first and accounting for the newline
// guarantees the rewritten file stays below the rotation trigger, so the next
// ordinary append does not re-rotate. Corrupt lines are dropped during the
// parse, matching readAudit semantics.
export async function rotateAudit() {
  let raw;
  try {
    raw = await fsp.readFile(AUDIT_FILE, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  const valid = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      JSON.parse(trimmed);
      valid.push(trimmed);
    } catch {
      /* ignore corrupt lines */
    }
  }
  const picked = [];
  let bytes = 0;
  for (let i = valid.length - 1; i >= 0; i--) {
    const lineBytes = Buffer.byteLength(valid[i], 'utf8') + 1;
    if (picked.length >= AUDIT_KEEP_ENTRIES) break;
    if (bytes + lineBytes > AUDIT_TARGET_BYTES && picked.length) break;
    picked.push(valid[i]);
    bytes += lineBytes;
  }
  picked.reverse();
  const tmp = `${AUDIT_FILE}.rotate-${process.pid}-${++tmpCounter}`;
  await fsp.writeFile(tmp, picked.length ? `${picked.join('\n')}\n` : '', { mode: 0o600 });
  await fsp.chmod(tmp, 0o600).catch(() => {});
  await fsp.rename(tmp, AUDIT_FILE);
  await fsp.chmod(AUDIT_FILE, 0o600).catch(() => {});
}

// Read the JSONL audit trail. Malformed lines are skipped rather than failing
// the whole read. Returns the most recent `limit` entries, newest first, plus
// the count of successfully parsed lines.
// Build the searchable text for an entry. The client summarizes the same
// identifying fields, so the free-text query behaves identically on the server.
function auditHaystack(entry) {
  return [
    entry.action,
    entry.method,
    entry.path,
    entry.repo,
    typeof entry.number === 'number' ? `#${entry.number}` : '',
  ].filter(Boolean).join(' ').toLowerCase();
}

// Read the audit trail with optional filters applied over every retained
// entry, before the limit window is taken. filters:
//   q       case-insensitive substring over action/summary fields
//   outcome 'all' (default) | 'ok' | 'fail'
export async function readAudit(limit = 200, filters = {}) {
  const needle = typeof filters.q === 'string' ? filters.q.trim().toLowerCase() : '';
  const outcome = filters.outcome === 'ok' || filters.outcome === 'fail' ? filters.outcome : 'all';
  const bounded = Math.max(1, Math.min(1000, Number(limit) || 200));
  const matched = [];
  let total = 0;
  let input;
  let lines;
  try {
    input = createReadStream(AUDIT_FILE, { encoding: 'utf8' });
    lines = readline.createInterface({ input, crlfDelay: Infinity });
    for await (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let entry;
      try {
        entry = JSON.parse(trimmed);
      } catch {
        continue; // ignore corrupt lines
      }
      if (outcome === 'ok' && entry.ok === false) continue;
      if (outcome === 'fail' && entry.ok !== false) continue;
      if (needle && !auditHaystack(entry).includes(needle)) continue;
      total += 1;
      matched.push(entry);
      // Keep only the newest bounded window while scanning; `total` still
      // reflects every match because filters apply to the whole file.
      if (matched.length > bounded) matched.shift();
    }
  } catch (err) {
    if (err.code === 'ENOENT') return { entries: [], total: 0 };
    throw err;
  } finally {
    lines?.close();
    input?.destroy();
  }
  return { entries: matched.reverse(), total };
}
