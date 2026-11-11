import { post, request } from './core';

// ---------- history rewriting / state mutation ----------

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

export const checkoutPrHead = (repo: string, number: number, branch?: string) =>
  post('/api/pr/checkout', { repo, number, ...(branch ? { branch } : {}) }) as Promise<{
    ok: boolean;
    branch: string;
    sha: string;
  }>;

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

// Line-level staging: `lines` are body line indexes inside the hunk (0 is the
// first line after the @@ header), matching the server's hunk parser.
export const stageLines = (
  repo: string,
  file: string,
  hunk: number,
  lines: number[],
  action: 'stage' | 'unstage',
) => post('/api/stage-lines', { repo, file, hunk, lines, action });

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

export interface BatchPullResult {
  results: Array<{ repo: string; ok: boolean; result?: string; error?: string }>;
  okCount: number;
  failCount: number;
}

export const pullReposBatch = (repos: string[]) =>
  post('/api/repos/pull', { repos }) as Promise<BatchPullResult>;

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

export const resolveConflict = (
  repo: string,
  path: string,
  strategy: 'ours' | 'theirs' | 'mark',
) => post('/api/conflict/resolve', { repo, path, strategy }) as Promise<{
  ok: boolean;
  path: string;
  strategy: string;
  remaining: string[];
}>;

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

// ---------- history rewriting ----------

export const cherryPick = (repo: string, sha: string) =>
  post('/api/cherry-pick', { repo, sha }) as Promise<{ ok: boolean; picked: string }>;

export const undoLastCommit = (repo: string) =>
  post('/api/undo-commit', { repo }) as Promise<{ ok: boolean }>;
