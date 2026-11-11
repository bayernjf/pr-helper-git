import { describe, expect, it } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  isNoise,
  reconcileWatching,
  stopAllWatching,
  watchedCount,
} from './watcher.mjs';

describe('isNoise', () => {
  it('ignores transient lock files at any depth', () => {
    expect(isNoise('.git/index.lock')).toBe(true);
    expect(isNoise('.git/refs/heads/main.lock')).toBe(true);
    expect(isNoise('.git/packed-refs.lock')).toBe(true);
    expect(isNoise('some/dir/file.lock')).toBe(true);
  });

  it('ignores in-flight temporary object files', () => {
    expect(isNoise('.git/objects/ab/tmp_obj_xyz')).toBe(true);
  });

  it('ignores dependency and build output directories', () => {
    expect(isNoise('node_modules/lib/index.js')).toBe(true);
    expect(isNoise('dist/assets/index.js')).toBe(true);
  });

  it('keeps meaningful git state events', () => {
    expect(isNoise('.git/HEAD')).toBe(false);
    expect(isNoise('.git/refs/heads/main')).toBe(false);
    expect(isNoise('.git/index')).toBe(false);
    expect(isNoise('.git/packed-refs')).toBe(false);
  });

  it('keeps ordinary working-tree source files', () => {
    expect(isNoise('src/index.js')).toBe(false);
    expect(isNoise('README.md')).toBe(false);
  });

  it('handles empty or missing filenames', () => {
    expect(isNoise('')).toBe(false);
    expect(isNoise(undefined)).toBe(false);
  });
});

describe('reconcileWatching', () => {
  it('adds missing watchers and removes paths no longer registered', async () => {
    const a = await fsp.mkdtemp(path.join(os.tmpdir(), 'git2-watch-a-'));
    const b = await fsp.mkdtemp(path.join(os.tmpdir(), 'git2-watch-b-'));
    try {
      reconcileWatching([a, b]);
      expect(watchedCount()).toBe(2);
      reconcileWatching([a]);
      expect(watchedCount()).toBe(1);
    } finally {
      stopAllWatching();
      await fsp.rm(a, { recursive: true, force: true });
      await fsp.rm(b, { recursive: true, force: true });
    }
  });
});
