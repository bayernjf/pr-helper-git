import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let tmpRoot;
let homeDir;
let store;
const repo1 = '/repo-1';

beforeAll(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'git2-store-'));
  homeDir = path.join(tmpRoot, 'home');
  process.env.PR_HELPER_HOME = homeDir;
  // Import after PR_HELPER_HOME is set: the module resolves its paths at load.
  store = await import('./store.mjs');
});

afterAll(async () => {
  delete process.env.PR_HELPER_HOME;
  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

describe('config store', () => {
  it('serializes concurrent read-modify-write updates', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.updateConfig((config) => {
      config.repos.push(`/repo-${i}`);
      return config.repos;
    })));
    expect(await store.listRepos()).toHaveLength(20);
  });

  it('tightens the data directory and files to 0700 / 0600', async () => {
    await store.updateConfig((config) => {
      config.repos = [repo1];
      return config.repos;
    });
    expect((await fsp.stat(homeDir)).mode & 0o777).toBe(0o700);
    expect((await fsp.stat(path.join(homeDir, 'config.json'))).mode & 0o777).toBe(0o600);
  });

  it('moves a corrupt config aside instead of silently emptying it', async () => {
    await fsp.writeFile(path.join(homeDir, 'config.json'), '{not json', 'utf8');
    const config = await store.loadConfig();
    expect(config.repos).toEqual([]);
    const entries = await fsp.readdir(homeDir);
    expect(entries.some((name) => name.includes('.corrupt-'))).toBe(true);
  });

  it('creates the audit log with 0600 permissions', async () => {
    await store.appendAudit({ action: 'store-test' });
    expect((await fsp.stat(path.join(homeDir, 'audit.log'))).mode & 0o777).toBe(0o600);
  });
});
