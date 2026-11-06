// Persistent local state: registered repository list and the audit trail.
// Nothing leaves this machine; the config lives under ~/.pr-helper-git2.
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

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

export async function loadConfig() {
  try {
    const raw = await fsp.readFile(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return { repos: Array.isArray(parsed.repos) ? parsed.repos : [] };
  } catch {
    return { repos: [] };
  }
}

async function saveConfig(config) {
  await fsp.mkdir(CONFIG_DIR, { recursive: true });
  const tmp = `${CONFIG_FILE}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(config, null, 2));
  await fsp.rename(tmp, CONFIG_FILE);
}

export async function listRepos() {
  return (await loadConfig()).repos;
}

export async function addRepo(absPath) {
  const config = await loadConfig();
  if (config.repos.includes(absPath)) return config.repos;
  config.repos.push(absPath);
  config.repos.sort();
  await saveConfig(config);
  return config.repos;
}

export async function removeRepo(absPath) {
  const config = await loadConfig();
  config.repos = config.repos.filter((p) => p !== absPath);
  await saveConfig(config);
  return config.repos;
}

export async function appendAudit(entry) {
  const line = `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`;
  try {
    await fsp.mkdir(CONFIG_DIR, { recursive: true });
    await fsp.appendFile(AUDIT_FILE, line);
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
  const tmp = `${AUDIT_FILE}.rotate-${process.pid}`;
  await fsp.writeFile(tmp, picked.length ? `${picked.join('\n')}\n` : '');
  await fsp.rename(tmp, AUDIT_FILE);
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
  let raw;
  try {
    raw = await fsp.readFile(AUDIT_FILE, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { entries: [], total: 0 };
    throw err;
  }
  const parsed = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      parsed.push(JSON.parse(trimmed));
    } catch {
      /* ignore corrupt lines */
    }
  }
  const needle = typeof filters.q === 'string' ? filters.q.trim().toLowerCase() : '';
  const outcome = filters.outcome === 'ok' || filters.outcome === 'fail' ? filters.outcome : 'all';
  const matched = parsed.filter((entry) => {
    if (outcome === 'ok' && entry.ok === false) return false;
    if (outcome === 'fail' && entry.ok !== false) return false;
    if (!needle) return true;
    return auditHaystack(entry).includes(needle);
  });
  const total = matched.length;
  const bounded = Math.max(1, Math.min(1000, Number(limit) || 200));
  return { entries: matched.slice(-bounded).reverse(), total };
}
