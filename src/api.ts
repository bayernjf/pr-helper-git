// Thin API client. In dev the Vite proxy injects the loopback token; in
// production the HttpOnly cookie authenticates same-origin requests.
import type {
  AuditEntry,
  Commit,
  DiffResult,
  LogFilters,
  ParsedStatus,
  Ref,
  RemoteEntry,
  RemoteInfo,
  RepoBrief,
} from './types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { cache: 'no-store', ...init });
  } catch (err) {
    throw new ApiError(0, 'network error — is the local server running?', String(err));
  }
  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    /* non-JSON response */
  }
  if (!response.ok) {
    throw new ApiError(response.status, payload?.error || `HTTP ${response.status}`, payload?.detail);
  }
  return payload as T;
}

function post(path: string, body: unknown) {
  return request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------- repository registry ----------

export const getRepos = () => request<{ repos: RepoBrief[] }>('/api/repos');

export const addRepo = (repo: string) =>
  post('/api/repos/add', { repo }) as Promise<{ repos: string[]; path: string }>;

export const removeRepo = (repo: string) =>
  post('/api/repos/remove', { repo }) as Promise<{ repos: string[] }>;

export const cloneRepo = (url: string, parentDir: string, name: string) =>
  post('/api/repos/clone', { url, parentDir, name }) as Promise<{ repos: string[]; path: string }>;

export const initRepo = (targetPath: string) =>
  post('/api/repos/init', { path: targetPath }) as Promise<{ repos: string[]; path: string }>;

export const resetCommit = (
  repo: string,
  sha: string,
  mode: 'soft' | 'mixed' | 'hard',
  confirm = false,
) => post('/api/reset', { repo, sha, mode, confirm }) as Promise<{ ok: boolean; mode: string }>;

export const revertCommit = (repo: string, sha: string, mainline?: number) =>
  post('/api/revert', { repo, sha, mainline}) as Promise<{
    ok: boolean;
    reverted: string;
    mainline?: number | null;
  }>;

export const revertCommitsBatch = (repo: string, shas: string[]) =>
  post('/api/revert-batch', { repo, shas }) as Promise<{
    ok: boolean;
    reverted: string[];
    count: number;
  }>;

export const ignoreFile = (repo: string, file: string) =>
  post('/api/ignore', { repo, file }) as Promise<{
    ok: boolean;
    ignored: string;
    added: boolean;
  }>;

export interface GrepMatch {
  path: string;
  line: number;
  text: string;
}

export const searchGrep = (repo: string, pattern: string, path?: string) =>
  request<{ matches: GrepMatch[]; total: number; truncated: boolean }>(
    `/api/grep?repo=${encodeURIComponent(repo)}&pattern=${encodeURIComponent(pattern)}`
      + (path ? `&path=${encodeURIComponent(path)}` : ''),
  );

export interface GrepRepoResult {
  repo: string;
  name: string;
  matches: GrepMatch[];
  error?: string;
}

export const searchAllGrep = (pattern: string) =>
  request<{
    pattern: string;
    results: GrepRepoResult[];
    total: number;
    truncated: boolean;
    limit: number;
  }>(`/api/grep-all?pattern=${encodeURIComponent(pattern)}`);

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

export const getCommitDiff = (repo: string, sha: string, file: string) =>
  request<DiffResult>(
    `/api/commit-diff?repo=${encodeURIComponent(repo)}&sha=${encodeURIComponent(sha)}`
      + `&file=${encodeURIComponent(file)}`,
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
}

export const getCompare = (repo: string, base: string, head: string) =>
  request<CompareResult>(
    `/api/compare?repo=${encodeURIComponent(repo)}`
      + `&base=${encodeURIComponent(base)}&head=${encodeURIComponent(head)}`,
  );

// ---------- git writes ----------

export const stageFile = (repo: string, file: string, action: 'stage' | 'unstage') =>
  post('/api/stage', { repo, file, action });

export const stageAll = (repo: string, action: 'stage' | 'unstage') =>
  post('/api/stage-all', { repo, action });

export const stageHunk = (
  repo: string,
  file: string,
  hunk: number,
  action: 'stage' | 'unstage',
) => post('/api/stage-hunk', { repo, file, hunk, action });

export const discardHunk = (repo: string, file: string, hunk: number) =>
  post('/api/discard-hunk', { repo, file, hunk, confirm: true });

export const commitChanges = (repo: string, message: string, allowEmpty = false) =>
  post('/api/commit', { repo, message, allowEmpty });

export const getCommitTemplate = (repo: string) =>
  request<{ configured: boolean; path?: string; text?: string }>(
    `/api/commit-template?repo=${encodeURIComponent(repo)}`,
  );

export interface ConfigEntry {
  key: string;
  type: 'text' | 'email' | 'branch' | 'enum';
  options?: string[];
  local: string | null;
  effective: string | null;
  inherited: boolean;
}

export const getConfig = (repo: string) =>
  request<{ entries: ConfigEntry[] }>(`/api/config?repo=${encodeURIComponent(repo)}`);

export const saveConfig = (repo: string, key: string, value: string) =>
  post('/api/config', { repo, key, value }) as Promise<{
    ok: boolean;
    key: string;
    local: string | null;
  }>;

export const discardFile = (repo: string, file: string) =>
  post('/api/discard', { repo, file, confirm: true });

export const checkoutRef = (repo: string, ref: string) => post('/api/checkout', { repo, ref });

export const createBranch = (repo: string, name: string, from?: string, noCheckout = false) =>
  post('/api/branch/create', { repo, name, from, noCheckout });

export const deleteBranch = (repo: string, name: string, force = false) =>
  post('/api/branch/delete', { repo, name, force });

export type MergeStrategy = 'default' | 'no-ff' | 'ff-only' | 'squash';

export const mergeRef = (repo: string, ref: string, strategy: MergeStrategy = 'default') =>
  post('/api/merge', { repo, ref, strategy });

export const fetchRepo = (repo: string, prune = false) => post('/api/fetch', { repo, prune });

export const pullRepo = (repo: string, rebase = false) =>
  post('/api/pull', { repo, rebase });

export type ForcePushMode = 'force' | 'force-with-lease';

export const pushRepo = (
  repo: string,
  setUpstream = false,
  force: ForcePushMode | null = null,
  confirm = false,
) => post('/api/push', { repo, setUpstream, force, confirm });

export const stashCreate = (repo: string, message?: string, includeUntracked = false) =>
  post('/api/stash/create', { repo, message, includeUntracked });

export const stashApply = (repo: string, index: number, drop: boolean) =>
  post('/api/stash/apply', { repo, index, drop });

export const stashDrop = (repo: string, index: number) =>
  post('/api/stash/drop', { repo, index });

export const renameBranch = (repo: string, name: string, newName: string) =>
  post('/api/branch/rename', { repo, name, newName });

export const createTag = (
  repo: string,
  name: string,
  message?: string,
  from?: string,
  force = false,
) => post('/api/tag/create', { repo, name, message: message || undefined, from, force });

export const deleteTag = (repo: string, name: string) =>
  post('/api/tag/delete', { repo, name });

export const deleteRemoteTag = (repo: string, name: string, remote = 'origin') =>
  post('/api/tag/delete-remote', { repo, name, remote, confirm: true });

export const abortMerge = (repo: string) => post('/api/merge/abort', { repo });

export const continueRebase = (repo: string) => post('/api/rebase/continue', { repo });

export const abortRebase = (repo: string) => post('/api/rebase/abort', { repo });

export const continueRevert = (repo: string) => post('/api/revert/continue', { repo });

export const abortRevert = (repo: string) => post('/api/revert/abort', { repo });

export const pushBranch = (repo: string, name: string, remote = 'origin') =>
  post('/api/branch/push', { repo, name, remote });

export const pushTag = (repo: string, name: string, remote = 'origin') =>
  post('/api/tag/push', { repo, name, remote }) as Promise<{
    ok: boolean;
    pushed: string;
    remote: string;
  }>;

export const deleteRemoteBranch = (repo: string, name: string, remote = 'origin') =>
  post('/api/branch/delete-remote', { repo, name, remote });

export const amendCommit = (repo: string, message: string) =>
  post('/api/amend', { repo, message });

export const cleanDryRun = (repo: string) =>
  post('/api/clean', { repo, dryRun: true }) as Promise<{ dryRun: true; paths: string[] }>;

export const cleanForce = (repo: string) =>
  post('/api/clean', { repo, dryRun: false, confirm: true }) as Promise<{
    dryRun: false;
    removed: string[];
  }>;

export const addRemote = (repo: string, name: string, url: string) =>
  post('/api/remote/add', { repo, name, url });

export const removeRemote = (repo: string, name: string) =>
  post('/api/remote/remove', { repo, name });

export const setRemoteUrl = (repo: string, name: string, url: string, push = false) =>
  post('/api/remote/set-url', { repo, name, url, push });

export const renameRemote = (repo: string, oldName: string, newName: string) =>
  post('/api/remote/rename', { repo, oldName, newName });

export const setBranchUpstream = (repo: string, upstream: string, branch?: string) =>
  post('/api/branch/set-upstream', { repo, upstream, branch });

// ---------- GitHub proxy ----------

export const mergePull = (
  repo: string,
  number: number,
  mergeMethod: 'merge' | 'squash' | 'rebase',
  pat: string,
) =>
  request('/api/merge-pull', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-pat': pat,
    },
    body: JSON.stringify({ repo, number, mergeMethod }),
  }) as Promise<{ merged: boolean; changed: boolean; state: string }>;

export const markReadyForReview = (repo: string, number: number, pat: string) =>
  request('/api/ready-for-review', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-pat': pat,
    },
    body: JSON.stringify({ repo, number }),
  }) as Promise<{
    ready: boolean;
    changed: boolean;
    isDraft?: boolean;
  }>;

export function githubProxy<T>(
  pat: string,
  path: string,
  method = 'GET',
  payload?: unknown,
): Promise<{ status: number; data: T }> {
  return request('/api/github', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-github-pat': pat },
    body: JSON.stringify({ path, method, payload }),
  });
}
