// Small JSON-backed preference store in localStorage. A single object is kept
// under one key so independent preferences do not collide; malformed stored
// data falls back to defaults rather than crashing the app.
const PREFS_KEY = 'git2-prefs';

type Store = Record<string, unknown>;

function readStore(): Store {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(store));
  } catch {
    /* storage full or unavailable; preferences are best-effort */
  }
}

export function getPref<T>(key: string, fallback: T): T {
  const store = readStore();
  return Object.prototype.hasOwnProperty.call(store, key) ? (store[key] as T) : fallback;
}

// Whether an explicit preference has been stored, distinguishing a default
// value from a user-chosen one that happens to equal it.
export function hasPref(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(readStore(), key);
}

export function setPref<T>(key: string, value: T): void {
  const store = readStore();
  store[key] = value;
  writeStore(store);
}

// Compose a stable per-repository preference key.
export function repoPref(repoPath: string, name: string): string {
  return `${name}:${repoPath}`;
}
