// File watcher + SSE hub. Every registered repo is watched recursively;
// events are debounced and broadcast so the client can refresh without
// polling. Loopback token auth is enforced by the HTTP layer.
import fs from 'node:fs';

const clients = new Set();
const watchers = new Map(); // repo path -> FSWatcher
const timers = new Map(); // repo path -> debounce timer
const DEBOUNCE_MS = 400;

// Lock files and in-flight temp objects are create/delete pairs that never
// represent a committed state; ignoring them keeps git's internal churn
// (e.g. a background process repeatedly taking index.lock) from broadcasting
// spurious repo-changed frames. Meaningful HEAD/refs/index events still fire.
export function isNoise(filename) {
  if (!filename) return false;
  const parts = filename.split(/[\\/]/);
  const base = parts[parts.length - 1];
  if (base.endsWith('.lock')) return true;
  if (parts[0] === '.git' && parts[1] === 'objects' && base.startsWith('tmp_obj_')) return true;
  // Dependency and build directories are never shown as tracked source.
  if (parts[0] === 'node_modules' || parts[0] === 'dist') return true;
  return false;
}

function broadcast(path) {
  const payload = `data: ${JSON.stringify({ type: 'repo-changed', path })}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

export function ensureWatching(repoPath) {
  if (watchers.has(repoPath)) return;
  let watcher;
  try {
    watcher = fs.watch(repoPath, { recursive: true }, (eventType, filename) => {
      if (isNoise(filename)) return;
      const existing = timers.get(repoPath);
      if (existing) clearTimeout(existing);
      timers.set(repoPath, setTimeout(() => {
        timers.delete(repoPath);
        broadcast(repoPath);
      }, DEBOUNCE_MS));
    });
  } catch {
    return; // platform without recursive watch; SSE simply stays quiet
  }
  watcher.on('error', () => stopWatching(repoPath));
  watchers.set(repoPath, watcher);
}

export function stopWatching(repoPath) {
  const watcher = watchers.get(repoPath);
  if (watcher) watcher.close();
  watchers.delete(repoPath);
  const timer = timers.get(repoPath);
  if (timer) clearTimeout(timer);
  timers.delete(repoPath);
}

export function stopAllWatching() {
  for (const watcher of watchers.values()) watcher.close();
  watchers.clear();
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
}

export function addClient(res) {
  clients.add(res);
}

export function removeClient(res) {
  clients.delete(res);
}

export function watchedCount() {
  return watchers.size;
}
