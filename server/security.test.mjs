import { describe, expect, it } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  isSensitivePath,
  normalizeRepoPath,
  resolveInside,
  validateCloneUrl,
  validateFolderName,
  validateRefName,
} from './security.mjs';

async function withTempDir(run) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'git2-sec-'));
  try {
    return await run(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

describe('resolveInside', () => {
  it('resolves files when the repository root itself is a symlink', async () => {
    await withTempDir(async (dir) => {
      const real = path.join(dir, 'real-repo');
      const link = path.join(dir, 'linked-repo');
      await fsp.mkdir(real);
      await fsp.symlink(real, link, 'dir');
      const resolved = await resolveInside(link, 'src/app.ts');
      expect(resolved).toBe(path.join(await fsp.realpath(real), 'src', 'app.ts'));
    });
  });

  it('rejects paths that escape through an internal symlink', async () => {
    await withTempDir(async (dir) => {
      const repo = path.join(dir, 'repo');
      const outside = path.join(dir, 'outside');
      await fsp.mkdir(repo);
      await fsp.mkdir(outside);
      await fsp.symlink(outside, path.join(repo, 'escape'), 'dir');
      expect(await resolveInside(repo, 'escape/secret.txt')).toBeNull();
    });
  });
});

describe('normalizeRepoPath', () => {
  it('accepts safe relative paths', () => {
    expect(normalizeRepoPath('src/a.ts')).toBe('src/a.ts');
  });

  it('rejects traversal, absolute and dot segments', () => {
    expect(normalizeRepoPath('../a')).toBeNull();
    expect(normalizeRepoPath('/abs/path')).toBeNull();
    expect(normalizeRepoPath('a/./b')).toBeNull();
    expect(normalizeRepoPath('a//b')).toBeNull();
    expect(normalizeRepoPath('a\0b')).toBeNull();
  });
});

describe('isSensitivePath', () => {
  it('masks env, keys and certificates', () => {
    expect(isSensitivePath('.env')).toBe(true);
    expect(isSensitivePath('config/.env.production')).toBe(true);
    expect(isSensitivePath('id_rsa')).toBe(true);
    expect(isSensitivePath('id_ed25519')).toBe(true);
    expect(isSensitivePath('keys/id_ecdsa')).toBe(true);
    expect(isSensitivePath('.git-credentials')).toBe(true);
    expect(isSensitivePath('certs/server.pem')).toBe(true);
    expect(isSensitivePath('bundle.p12')).toBe(true);
  });

  it('keeps ordinary files readable', () => {
    expect(isSensitivePath('src/app.ts')).toBe(false);
    expect(isSensitivePath('notes.txt')).toBe(false);
  });
});

describe('validateRefName', () => {
  it('accepts ordinary branch names', () => {
    expect(validateRefName('feature/login')).toBe('feature/login');
  });

  it('rejects option-like and illegal names', () => {
    expect(validateRefName('-x')).toBe(false);
    expect(validateRefName('a b')).toBe(false);
    expect(validateRefName('a..b')).toBe(false);
  });
});

describe('validateCloneUrl', () => {
  it('accepts network transports and scp-like ssh', () => {
    expect(validateCloneUrl('https://github.com/you/repo.git')).toBe(true);
    expect(validateCloneUrl('git@github.com:you/repo.git')).toBe(true);
    expect(validateCloneUrl('ssh://git@github.com/you/repo.git')).toBe(true);
    expect(validateCloneUrl('git://example.com/repo.git')).toBe(true);
  });

  it('rejects local files, option-like and malformed input', () => {
    expect(validateCloneUrl('file:///etc/passwd')).toBe(false);
    expect(validateCloneUrl('/Users/you/repo')).toBe(false);
    expect(validateCloneUrl('-u')).toBe(false);
    expect(validateCloneUrl('')).toBe(false);
  });
});

describe('validateFolderName', () => {
  it('accepts a safe single component', () => {
    expect(validateFolderName('my-repo')).toBe('my-repo');
    expect(validateFolderName('project1')).toBe('project1');
  });

  it('rejects paths, traversal and dot names', () => {
    expect(validateFolderName('a/b')).toBe(false);
    expect(validateFolderName('..')).toBe(false);
    expect(validateFolderName('.hidden')).toBe(false);
    expect(validateFolderName('')).toBe(false);
  });
});
