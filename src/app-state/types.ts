import type { Accent, ThemeMode } from '../lib/appearance';
import type {
  Commit,
  LogFilters,
  ParsedStatus,
  Ref,
  RemoteInfo,
  RepoBrief,
} from '../types';

export type View = 'git' | 'pr' | 'dashboard' | 'flows' | 'ci';
export type Theme = ThemeMode;

// Preferences domain: view, theme, accent, PAT and server-PAT state.
// `refreshServerPat` is internal to the repo-load path (it re-reads server PAT
// availability after each repo load, fire-and-forget); consumers use
// `hasServerPat` / `setServerPat` / `clearServerPat` instead.
export interface Preferences {
  view: View;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  theme: Theme;
  accent: Accent;
  pat: string;
  hasServerPat: boolean;
  setView: (view: View) => void;
  setTheme: (mode: Theme) => void;
  setAccent: (accent: Accent) => void;
  toggleTheme: () => void;
  setPat: (value: string) => void;
  setServerPat: (value: string) => Promise<{ hasServerPat: boolean }>;
  clearServerPat: () => Promise<{ hasServerPat: boolean }>;
  refreshServerPat: () => void;
}

// Repo-data domain: registry, active repo payload, SSE-driven refresh, the
// history window (limit/scope/path/filters) and the load-generation guards.
export interface RepoData {
  repos: RepoBrief[];
  /** False until the first registry load resolves — distinguishes "loading"
      from a genuinely empty registry so views never fake an empty state. */
  reposLoaded: boolean;
  activeRepo: string | null;
  activeBrief: RepoBrief | null;
  status: ParsedStatus | null;
  commits: Commit[];
  refs: Ref[];
  remote: RemoteInfo | null;
  selectedHash: string | null;
  repoLoading: boolean;
  logLimit: number;
  logScope: 'all' | 'current';
  logPath: string;
  logFilters: LogFilters;
  setLogPath: (path: string) => void;
  setLogFilters: (filters: LogFilters) => void;
  setLogScope: (scope: 'all' | 'current') => void;
  selectRepo: (path: string) => void;
  selectCommit: (hash: string | null) => void;
  refreshRepos: () => Promise<RepoBrief[]>;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
}

// Write-action domain: `runAction` runs a write then refreshes all data.
// `busy` is exposed through a separate context so runAction-only consumers do
// not re-render when it flips.
export interface Actions {
  runAction: <T>(action: Promise<T>, successMessage?: string) => Promise<T | null>;
}
