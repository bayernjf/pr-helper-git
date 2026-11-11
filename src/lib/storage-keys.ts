// Storage keys for pr-helper-git.
//
// 2026-11-12 rename: old keys carried the "git2" / "pr-helper-git2" prefix from
// the pre-rename product name. The migration below copies any old localStorage
// value to the new key on first load, then removes the old key.
//
// If you add a new key, use the `PR_HELPER_GIT_PREFIX` convention below.

const PREFIX = 'pr-helper-git';

export const STORAGE_KEYS = {
  pinned: `${PREFIX}:pinned`,
  draft: (repo: string) => `${PREFIX}:draft:${repo}`,
  diffFont: `${PREFIX}:diff-font`,
  prefs: `${PREFIX}:prefs`,
  dashboardSort: `${PREFIX}:dashboard-sort`,
  dashboardAutofetch: `${PREFIX}:dashboard-autofetch`,
} as const;

// Map of legacy key -> new key (or null for repo-prefixed dynamic keys).
const LEGACY_PINNED = 'pr-helper-git2-pinned';
const LEGACY_DIFF_FONT = 'git2-diff-font';
const LEGACY_PREFS = 'git2-prefs';
const LEGACY_DRAFT_PREFIX = 'git2-draft:';
const LEGACY_DASHBOARD_SORT = 'git2-dashboard-sort';
const LEGACY_DASHBOARD_AUTOFETCH = 'git2-dashboard-autofetch';
const MIGRATION_FLAG = `${PREFIX}:storage-migrated`;

function migrateKey(oldKey: string, newKey: string) {
  try {
    if (localStorage.getItem(newKey) !== null) return; // new key already set
    const val = localStorage.getItem(oldKey);
    if (val === null) return;
    localStorage.setItem(newKey, val);
    localStorage.removeItem(oldKey);
  } catch {
    // private browsing / quota / disabled storage: non-fatal
  }
}

/**
 * Idempotent localStorage migration. Safe to call from module top-level.
 */
export function migrateStorage() {
  try {
    if (localStorage.getItem(MIGRATION_FLAG) === '1') return;

    migrateKey(LEGACY_PINNED, STORAGE_KEYS.pinned);
    migrateKey(LEGACY_DIFF_FONT, STORAGE_KEYS.diffFont);
    migrateKey(LEGACY_PREFS, STORAGE_KEYS.prefs);
    migrateKey(LEGACY_DASHBOARD_SORT, STORAGE_KEYS.dashboardSort);
    migrateKey(LEGACY_DASHBOARD_AUTOFETCH, STORAGE_KEYS.dashboardAutofetch);

    // Dynamic draft keys: iterate all keys, rename matching ones.
    const toMove: Array<[string, string]> = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LEGACY_DRAFT_PREFIX)) {
        const repo = k.slice(LEGACY_DRAFT_PREFIX.length);
        toMove.push([k, STORAGE_KEYS.draft(repo)]);
      }
    }
    for (const [oldKey, newKey] of toMove) migrateKey(oldKey, newKey);

    localStorage.setItem(MIGRATION_FLAG, '1');
  } catch {
    // storage unavailable; nothing to migrate
  }
}
