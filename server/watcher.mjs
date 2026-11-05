// File watcher + SSE hub. Every registered repo is watched recursively;
// events are debounced and broadcast so the client can refresh without
// polling. Loopback token auth is enforced by the HTTP layer.
import fs from 'node:fs';

const clients = new Set();
const watchers = new Map(); // repo path -> FSWatcher
const timers = new Map(); // repo path -> debounce timer
const DEBOUNCE_MS = 400;

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
    watcher = fs.watch(repoPath, { recursive: true }, () => {
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

export function addClient(res) {
  clients.add(res);
}

export function removeClient(res) {
  clients.delete(res);
}

export function watchedCount() {
  return watchers.size;
}
