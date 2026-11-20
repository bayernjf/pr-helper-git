// Shared client types mirroring the server's JSON shapes.

export interface RepoBrief {
  path: string;
  name: string;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  unmerged: number;
  untracked: number;
  lastCommit: { at: string; subject: string } | null;
  error: string | null;
}

export type FileArea = 'staged' | 'unstaged' | 'untracked' | 'unmerged';

export interface StatusFile {
  path: string;
  status: string;
  area: FileArea;
  renamedFrom?: string | null;
}

export interface RepoState {
  mergeInProgress: boolean;
  rebaseInProgress: boolean;
  rebaseType: 'merge' | 'apply' | null;
  revertInProgress?: boolean;
}

export interface ParsedStatus {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: StatusFile[];
  state?: RepoState;
}

export interface LogFilters {
  author?: string;
  message?: string;
  since?: string;
  until?: string;
}

export interface Commit {
  hash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  date: string;
  subject: string;
  body: string;
}

export interface Ref {
  hash: string;
  type: string;
  name: string;
  shortName: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  // True when the configured upstream ref no longer exists on the remote.
  gone?: boolean;
}

export interface DiffResult {
  masked: boolean;
  path: string;
  diff: string;
  truncated: boolean;
  untracked?: boolean;
}

export interface RemoteInfo {
  url: string;
  isGithub: boolean;
  owner?: string;
  repo?: string;
}

export interface RemoteEntry {
  name: string;
  fetch: string | null;
  push: string | null;
}

/** UNKNOWN = the lazy review summary has not loaded (or failed to load) yet;
 *  an open card must not claim "No review" while the truth is simply unknown. */
export type ReviewState = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'NONE' | 'UNKNOWN';

export interface PullRequest {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  merged?: boolean;
  merged_at?: string | null;
  draft: boolean;
  user: { login: string; avatar_url: string };
  head: { ref: string; sha: string; label: string };
  base: { ref: string; sha: string; label: string };
  html_url: string;
  created_at: string;
  updated_at: string;
  mergeable: boolean | null;
  mergeable_state: string;
  labels: Array<{ name: string; color?: string }>;
  reviewState: ReviewState;
}

export interface CheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
}

export type CiHealthState = 'success' | 'failure' | 'pending' | 'none';

export interface CiFailedCheck {
  name: string;
  state: string;
  detail: string;
  url: string;
  category: string;
}

export interface CiHealthPr {
  repository: string;
  number: number;
  title: string;
  state: string;
  merged: boolean;
  mergedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  url: string;
  draft: boolean;
  headSha: string;
  ciState: CiHealthState;
  failedChecks: CiFailedCheck[];
}

export interface CiHealthRepo {
  repository: string;
  defaultBranch: string;
  defaultBranchSha: string;
  prCount: number;
  passed: number;
  failed: number;
  pending: number;
  blocked: number;
  passRate: number | null;
  failureRate: number | null;
  postMerge: {
    state: CiHealthState;
    sha: string;
    failedChecks: CiFailedCheck[];
  };
  topCategories: string[];
}

export interface CiFailureCategory {
  id: string;
  label: string;
  count: number;
  share: number;
}

export interface CiHealthTotals {
  prCount: number;
  passed: number;
  failed: number;
  pending: number;
  blocked: number;
  postMergeFailures: number;
  reposWithPrs: number;
  scannedRepos: number;
  passRate: number | null;
  failureRate: number | null;
}

export interface CiHealthReport {
  generatedAt: string;
  windowDays: number;
  scope: string;
  prLimitPerRepo: number;
  totals: CiHealthTotals;
  repos: CiHealthRepo[];
  failedPrs: CiHealthPr[];
  failureCategories: CiFailureCategory[];
  warnings: string[];
  cached?: boolean;
}

// Audit records share a timestamp and a small set of common fields; the
// remaining keys depend on the action and are kept as an open index.
export interface AuditEntry {
  at: string;
  ok?: boolean;
  action?: string;
  repo?: string;
  method?: string;
  path?: string;
  number?: number;
  [key: string]: unknown;
}
