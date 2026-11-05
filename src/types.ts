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

export interface ParsedStatus {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: StatusFile[];
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
}

export interface DiffResult {
  masked: boolean;
  path: string;
  diff: string;
  truncated: boolean;
}

export interface RemoteInfo {
  url: string;
  isGithub: boolean;
  owner?: string;
  repo?: string;
}

export interface PullRequest {
  number: number;
  title: string;
  state: 'open' | 'closed';
  merged: boolean;
  draft: boolean;
  user: { login: string; avatar_url: string };
  head: { ref: string; sha: string; label: string };
  base: { ref: string; sha: string; label: string };
  html_url: string;
  created_at: string;
  updated_at: string;
  mergeable: boolean | null;
  mergeable_state: string;
  labels: Array<{ name: string }>;
}

export interface CheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
}
