// Thin API client. In dev the Vite proxy injects the loopback token; in
// production the HttpOnly cookie authenticates same-origin requests.
import type {
  Commit,
  DiffResult,
  ParsedStatus,
  Ref,
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
  post('/api/repos/add', { repo }) as Promise<{ repos: string[] }>;

export const removeRepo = (repo: string) =>
  post('/api/repos/remove', { repo }) as Promise<{ repos: string[] }>;

// ---------- git reads ----------

export const getStatus = (repo: string) =>
  request<{ status: ParsedStatus }>(`/api/status?repo=${encodeURIComponent(repo)}`);

export const getLog = (repo: string, limit = 200) =>
  request<{ commits: Commit[] }>(`/api/log?repo=${encodeURIComponent(repo)}&limit=${limit}`);

export const getRefs = (repo: string) =>
  request<{ refs: Ref[] }>(`/api/refs?repo=${encodeURIComponent(repo)}`);

export const getDiff = (repo: string, file: string, staged: boolean) =>
  request<DiffResult>(
    `/api/diff?repo=${encodeURIComponent(repo)}&file=${encodeURIComponent(file)}`
      + `&staged=${staged ? '1' : '0'}`,
  );

export const getCommitDetail = (repo: string, sha: string) =>
  request<{ sha: string; detail: string }>(
    `/api/commit?repo=${encodeURIComponent(repo)}&sha=${encodeURIComponent(sha)}`,
  );

export const getRemote = (repo: string) =>
  request<{ remote: RemoteInfo | null }>(`/api/remote?repo=${encodeURIComponent(repo)}`);

// ---------- git writes ----------

export const stageFile = (repo: string, file: string, action: 'stage' | 'unstage') =>
  post('/api/stage', { repo, file, action });

export const stageAll = (repo: string, action: 'stage' | 'unstage') =>
  post('/api/stage-all', { repo, action });

export const commitChanges = (repo: string, message: string) =>
  post('/api/commit', { repo, message });

export const discardFile = (repo: string, file: string) =>
  post('/api/discard', { repo, file, confirm: true });

export const checkoutRef = (repo: string, ref: string) => post('/api/checkout', { repo, ref });

export const createBranch = (repo: string, name: string, from?: string) =>
  post('/api/branch/create', { repo, name, from });

export const deleteBranch = (repo: string, name: string, force = false) =>
  post('/api/branch/delete', { repo, name, force });

export const mergeRef = (repo: string, ref: string) => post('/api/merge', { repo, ref });

export const fetchRepo = (repo: string) => post('/api/fetch', { repo });

export const pullRepo = (repo: string) => post('/api/pull', { repo });

export const pushRepo = (repo: string, setUpstream = false) =>
  post('/api/push', { repo, setUpstream });

export const stashCreate = (repo: string, message?: string) =>
  post('/api/stash/create', { repo, message });

export const stashApply = (repo: string, index: number, drop: boolean) =>
  post('/api/stash/apply', { repo, index, drop });

export const stashDrop = (repo: string, index: number) =>
  post('/api/stash/drop', { repo, index });

// ---------- GitHub proxy ----------

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
