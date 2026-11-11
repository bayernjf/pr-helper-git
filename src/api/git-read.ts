import type {
  AuditEntry,
  Commit,
  DiffResult,
  LogFilters,
  ParsedStatus,
  Ref,
  RemoteEntry,
  RemoteInfo,
} from '../types';
import { post, request } from './core';

// ---------- search ----------

export interface GrepMatch {
  path: string;
  line: number;
  text: string;
}

export interface GrepOptions {
  ignoreCase?: boolean;
  glob?: string;
}

export const searchGrep = (
  repo: string,
  pattern: string,
  path?: string,
  opts: GrepOptions = {},
) => {
  const params = new URLSearchParams({ repo, pattern });
  if (path) params.set('path', path);
  if (opts.ignoreCase) params.set('ignoreCase', '1');
  if (opts.glob) params.set('glob', opts.glob);
  return request<{ matches: GrepMatch[]; total: number; truncated: boolean }>(
    `/api/grep?${params.toString()}`,
  );
};

export interface GrepRepoResult {
  repo: string;
  name: string;
  matches: GrepMatch[];
  error?: string;
}

export const searchAllGrep = (pattern: string, opts: GrepOptions = {}) => {
  const params = new URLSearchParams({ pattern });
  if (opts.ignoreCase) params.set('ignoreCase', '1');
  if (opts.glob) params.set('glob', opts.glob);
  return request<{
    pattern: string;
    results: GrepRepoResult[];
    total: number;
    truncated: boolean;
    limit: number;
  }>(`/api/grep-all?${params.toString()}`);
};

// ---------- git reads ----------

export interface AuditFilters {
  q?: string;
  outcome?: 'all' | 'ok' | 'fail';
}

export const getAudit = (limit = 200, filters: AuditFilters = {}) => {
  const params = new URLSearchParams({ limit: String(limit) });
  if (filters.q) params.set('q', filters.q);
  if (filters.outcome && filters.outcome !== 'all') params.set('outcome', filters.outcome);
  return request<{ entries: AuditEntry[]; total: number; collectedAt: string }>(
    `/api/audit?${params.toString()}`,
  );
};

export interface StorageInfo {
  dataDir: string;
  files: { name: string; size: number }[];
}

export const getStorage = () => request<StorageInfo>('/api/storage');

export const rotateAudit = () =>
  request<{ ok: true }>('/api/maintenance/audit-rotate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });

export const pruneRepos = () =>
  request<{ ok: true; removed: number; total: number }>('/api/maintenance/prune-repos', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });

export const getStatus = (repo: string) =>
  request<{ status: ParsedStatus; state: ParsedStatus['state'] }>(
    `/api/status?repo=${encodeURIComponent(repo)}`,
  );

export const getLog = (
  repo: string,
  limit = 200,
  scope: 'all' | 'current' = 'all',
  path?: string,
  filters?: LogFilters,
) => {
  const params = [`/api/log?repo=${encodeURIComponent(repo)}`, `limit=${limit}`, `scope=${scope}`];
  if (path) params.push(`path=${encodeURIComponent(path)}`);
  if (filters?.author) params.push(`author=${encodeURIComponent(filters.author)}`);
  if (filters?.message) params.push(`message=${encodeURIComponent(filters.message)}`);
  if (filters?.since) params.push(`since=${encodeURIComponent(filters.since)}`);
  if (filters?.until) params.push(`until=${encodeURIComponent(filters.until)}`);
  return request<{ commits: Commit[]; scope?: string; path?: string | null; filters?: LogFilters }>(
    params.join('&'),
  );
};

export const searchCommits = (repo: string, q: string, limit = 30) =>
  request<{ commits: Commit[]; query: string; mode: 'message' | 'author' | 'path' }>(
    `/api/search-commits?repo=${encodeURIComponent(repo)}&q=${encodeURIComponent(q)}&limit=${limit}`,
  );

export type RebasePlan = {
  base: string;
  commits: Commit[];
  dirty: boolean;
  merges: string[];
  upstream: string | null;
  pushed: boolean;
};

export const rebasePlan = (repo: string, base: string) =>
  request<RebasePlan>(`/api/rebase/plan?repo=${encodeURIComponent(repo)}&base=${encodeURIComponent(base)}`);

export const rebaseInteractive = (
  repo: string,
  base: string,
  commands: { hash: string; action: string; message?: string }[],
) => post('/api/rebase/interactive', { repo, base, commands });

export const getRefs = (repo: string) =>
  request<{ refs: Ref[] }>(`/api/refs?repo=${encodeURIComponent(repo)}`);

export const getDiff = (
  repo: string,
  file: string,
  staged: boolean,
  ignoreWs = false,
  context?: number,
) =>
  request<DiffResult>(
    `/api/diff?repo=${encodeURIComponent(repo)}&file=${encodeURIComponent(file)}`
      + `&staged=${staged ? '1' : '0'}&ignoreWs=${ignoreWs ? '1' : '0'}`
      + (context === undefined ? '' : `&context=${context}`),
  );

export const getCommitDetail = (repo: string, sha: string) =>
  request<{ sha: string; detail: string }>(
    `/api/commit?repo=${encodeURIComponent(repo)}&sha=${encodeURIComponent(sha)}`,
  );

export const getCommitInfo = (repo: string, sha: string) =>
  request<{ commit: Commit }>(
    `/api/commit-info?repo=${encodeURIComponent(repo)}&sha=${encodeURIComponent(sha)}`,
  );

export const getRemote = (repo: string) =>
  request<{ remote: RemoteInfo | null }>(`/api/remote?repo=${encodeURIComponent(repo)}`);

export const getRemotes = (repo: string) =>
  request<{ remotes: RemoteEntry[] }>(`/api/remotes?repo=${encodeURIComponent(repo)}`);

export interface CommitFile {
  status: string;
  path: string;
  renamedFrom?: string;
  additions: number;
  deletions: number;
}

export interface CommitSignature {
  sha: string;
  /** %G? letter: G good, B bad, U unknown, N none, E cannot check, X/Y expired, R revoked. */
  status: string;
  signer: string;
  key: string;
  verified: boolean;
}

export interface SubmoduleEntry {
  /** ' ' up to date, '-' not initialized, '+' checked-out differs, 'U' conflicts. */
  state: string;
  sha: string;
  path: string;
  describe: string;
}

export interface BisectState {
  active: boolean;
  /** Branch/ref the session started from, restored by Reset. */
  start: string | null;
  current: { sha: string; subject: string } | null;
  log: string;
  decisions: { good: number; bad: number };
}

export const getBisectState = (repo: string) =>
  request<BisectState>(`/api/bisect?repo=${encodeURIComponent(repo)}`);

export const startBisect = (repo: string, good: string, bad: string) =>
  post('/api/bisect/start', { repo, good, bad }) as Promise<{ ok: boolean; message: string; state: BisectState }>;

export const markBisect = (repo: string, verdict: 'good' | 'bad') =>
  post('/api/bisect/mark', { repo, verdict }) as Promise<{ ok: boolean; message: string; state: BisectState }>;

export const resetBisect = (repo: string) =>
  post('/api/bisect/reset', { repo }) as Promise<{ ok: boolean; message: string; state: BisectState }>;

export const getSubmodules = (repo: string) =>
  request<{ entries: SubmoduleEntry[] }>(`/api/submodules?repo=${encodeURIComponent(repo)}`);

export const getCommitSignature = (repo: string, sha: string) =>
  request<CommitSignature>(
    `/api/signature?repo=${encodeURIComponent(repo)}&sha=${encodeURIComponent(sha)}`,
  );

export const getCommitFiles = (repo: string, sha: string) =>
  request<{ files: CommitFile[] }>(
    `/api/commit-files?repo=${encodeURIComponent(repo)}&sha=${encodeURIComponent(sha)}`,
  );

export interface StashEntry {
  index: number;
  selector: string;
  subject: string;
}

export const getStashList = (repo: string) =>
  request<{ entries: StashEntry[] }>(
    `/api/stash-list?repo=${encodeURIComponent(repo)}`,
  );

export const getCommitDiff = (repo: string, sha: string, file: string, ignoreWs = false) =>
  request<DiffResult>(
    `/api/commit-diff?repo=${encodeURIComponent(repo)}&sha=${encodeURIComponent(sha)}`
      + `&file=${encodeURIComponent(file)}&ignoreWs=${ignoreWs ? '1' : '0'}`,
  );

export interface FileContent {
  masked: boolean;
  path: string;
  binary: boolean;
  content: string;
  truncated: boolean;
  ref: string | null;
  mtimeMs: number | null;
}

export interface BlameLine {
  line: number;
  sha: string;
  author: string;
  email: string;
  time: number;
  summary: string;
  text: string;
}

export interface BlameResult {
  masked: boolean;
  path: string;
  lines: BlameLine[];
}

export const getFile = (repo: string, file: string, ref?: string) =>
  request<FileContent>(
    `/api/file?repo=${encodeURIComponent(repo)}&file=${encodeURIComponent(file)}`
      + (ref ? `&ref=${encodeURIComponent(ref)}` : ''),
  );

export const getBlame = (repo: string, file: string, ref?: string) =>
  request<BlameResult>(
    `/api/blame?repo=${encodeURIComponent(repo)}&file=${encodeURIComponent(file)}`
      + (ref ? `&ref=${encodeURIComponent(ref)}` : ''),
  );

export const getFileHistory = (repo: string, file: string) =>
  request<{ path: string; commits: Commit[] }>(
    `/api/file-history?repo=${encodeURIComponent(repo)}&file=${encodeURIComponent(file)}`,
  );

export const getStashShow = (repo: string, index: number) =>
  request<{ index: number; diff: string }>(
    `/api/stash-show?repo=${encodeURIComponent(repo)}&index=${index}`,
  );

export interface ReflogEntry {
  hash: string;
  ref: string;
  index: number;
  action: string;
  description: string;
}

export const getReflog = (repo: string) =>
  request<{ entries: ReflogEntry[] }>(
    `/api/reflog?repo=${encodeURIComponent(repo)}`,
  );

export interface TagDetail {
  object: string;
  type: string;
  tag: string;
  tagger: string;
  taggerEmail: string;
  time: number;
  subject: string;
  body: string;
}

export const getTagShow = (repo: string, tag: string) =>
  request<{ tag: TagDetail }>(
    `/api/tag-show?repo=${encodeURIComponent(repo)}&tag=${encodeURIComponent(tag)}`,
  );

export interface CompareResult {
  base: string;
  head: string;
  ahead: Commit[];
  behind: Commit[];
  files: CommitFile[];
  // Populated only when a side is the working tree; `git diff` cannot see these.
  untracked: string[];
}

export const getCompare = (repo: string, base: string, head: string) =>
  request<CompareResult>(
    `/api/compare?repo=${encodeURIComponent(repo)}`
      + `&base=${encodeURIComponent(base)}&head=${encodeURIComponent(head)}`,
  );
