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
  } catch (err) {
    // Audit failure must not crash the request; surface it on stderr.
    console.error(`audit write failed: ${err.message}`);
  }
}

// Read the JSONL audit trail. Malformed lines are skipped rather than failing
// the whole read. Returns the most recent `limit` entries, newest first, plus
// the count of successfully parsed lines.
export async function readAudit(limit = 200) {
  let raw;
  try {
    raw = await fsp.readFile(AUDIT_FILE, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { entries: [], total: 0 };
    throw err;
  }
  const entries = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      /* ignore corrupt lines */
    }
  }
  const total = entries.length;
  const bounded = Math.max(1, Math.min(1000, Number(limit) || 200));
  return { entries: entries.slice(-bounded).reverse(), total };
}
