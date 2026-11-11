import { beforeEach, describe, expect, it } from 'vitest';
import { migrateStorage, STORAGE_KEYS } from './storage-keys';

describe('legacy localStorage migration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('copies the fixed legacy keys and removes the old ones', () => {
    localStorage.setItem('git2-pat', 'ghp_legacy');
    localStorage.setItem('git2-active-repo', '/tmp/repo');
    localStorage.setItem('git2-commit-history', '["first"]');
    localStorage.setItem('git2-clone-parent', '/tmp');
    localStorage.setItem('pr-helper-git2-pinned', '/tmp/pinned');

    migrateStorage();

    expect(localStorage.getItem(STORAGE_KEYS.pat)).toBe('ghp_legacy');
    expect(localStorage.getItem(STORAGE_KEYS.activeRepo)).toBe('/tmp/repo');
    expect(localStorage.getItem(STORAGE_KEYS.commitHistory)).toBe('["first"]');
    expect(localStorage.getItem(STORAGE_KEYS.cloneParent)).toBe('/tmp');
    expect(localStorage.getItem(STORAGE_KEYS.pinned)).toBe('/tmp/pinned');
    expect(localStorage.getItem('git2-pat')).toBeNull();
    expect(localStorage.getItem('git2-active-repo')).toBeNull();
  });

  it('renames repo-prefixed draft keys', () => {
    localStorage.setItem('git2-draft:/tmp/repo', 'half-written message');

    migrateStorage();

    expect(localStorage.getItem(STORAGE_KEYS.draft('/tmp/repo'))).toBe('half-written message');
    expect(localStorage.getItem('git2-draft:/tmp/repo')).toBeNull();
  });

  it('does not overwrite a value already written under the new key', () => {
    localStorage.setItem('git2-prefs', '{"theme":"dark"}');
    localStorage.setItem(STORAGE_KEYS.prefs, '{"theme":"light"}');

    migrateStorage();

    expect(localStorage.getItem(STORAGE_KEYS.prefs)).toBe('{"theme":"light"}');
    expect(localStorage.getItem('git2-prefs')).toBe('{"theme":"dark"}');
  });

  it('runs only once thanks to the migration flag', () => {
    migrateStorage();
    localStorage.setItem('git2-pat', 'late value');

    migrateStorage();

    expect(localStorage.getItem(STORAGE_KEYS.pat)).toBeNull();
    expect(localStorage.getItem('git2-pat')).toBe('late value');
  });
});
