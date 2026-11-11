import type { RepoBrief } from '../types';
import { post, request } from './core';

// ---------- repository registry ----------

export const getRepos = () => request<{ repos: RepoBrief[] }>('/api/repos');

export const addRepo = (repo: string) =>
  post('/api/repos/add', { repo }) as Promise<{ repos: string[]; path: string }>;

export const openExternal = (repo: string, target: 'finder' | 'terminal' | 'editor') =>
  post('/api/repos/open-external', { repo, target });

/** Raw file bytes URL for image diffs (server serves images only). */
export const rawFileUrl = (repo: string, path: string, ref = 'HEAD') =>
  `/api/raw?repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(path)}&ref=${encodeURIComponent(ref)}`;

export const removeRepo = (repo: string) =>
  post('/api/repos/remove', { repo }) as Promise<{ repos: string[] }>;

export const cloneRepo = (url: string, parentDir: string, name: string) =>
  post('/api/repos/clone', { url, parentDir, name }) as Promise<{ repos: string[]; path: string }>;

export const initRepo = (targetPath: string) =>
  post('/api/repos/init', { path: targetPath }) as Promise<{ repos: string[]; path: string }>;

// ---------- working-tree file operations ----------

export const moveFile = (repo: string, from: string, to: string) =>
  post('/api/mv', { repo, from, to }) as Promise<{ ok: boolean; from: string; to: string }>;

export const removeFile = (repo: string, file: string, force = false) =>
  post('/api/rm', { repo, file, force }) as Promise<{ ok: boolean; file: string; force: boolean }>;

export const saveFile = (repo: string, file: string, content: string, expectedMtime: number | null) =>
  post('/api/save', { repo, file, content, expectedMtime }) as Promise<{
    ok: boolean;
    file: string;
    bytes: number;
    mtimeMs: number;
  }>;
