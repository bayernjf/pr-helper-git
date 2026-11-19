// Central application state: registry, active repo data, view switching,
// SSE-driven auto refresh and a helper that runs write actions then refreshes.
//
// The aggregate AppData has been split into four domain contexts (preferences,
// repo data, write actions, busy) plus the existing ToastProvider. This file is
// the compatibility barrel: it keeps `AppContext` / `useApp()` working by
// assembling the domain contexts back into the original AppData shape until the
// consumers migrate (Phase 2/3).
import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import type {
  Commit,
  LogFilters,
  ParsedStatus,
  Ref,
  RemoteInfo,
  RepoBrief,
} from './types';
import type { ToastKind } from './components/ui';
import type { Accent } from './lib/appearance';
import type { Theme, View } from './app-state/types';
import { PreferencesProvider, usePreferences } from './app-state/preferences-provider';
import { RepoDataProvider, useRepoData } from './app-state/repo-provider';
import { ActionsProvider, useRunAction, useBusy } from './app-state/actions-provider';
import { useAppToast } from './app-state/toast';

export { LOG_MAX } from './app-state/repo-provider';

interface AppData {
  repos: RepoBrief[];
  activeRepo: string | null;
  currentRepo: string | null;
  activeBrief: RepoBrief | null;
  status: ParsedStatus | null;
  commits: Commit[];
  refs: Ref[];
  remote: RemoteInfo | null;
  selectedHash: string | null;
  view: View;
  theme: Theme;
  accent: Accent;
  pat: string;
  hasServerPat: boolean;
  busy: boolean;
  repoLoading: boolean;
  logLimit: number;
  logScope: 'all' | 'current';
  logPath: string;
  logFilters: LogFilters;
  setLogPath: (path: string) => void;
  setLogFilters: (filters: LogFilters) => void;
  toast: (message: string, kind?: ToastKind) => void;
  setPat: (value: string) => void;
  setServerPat: (value: string) => Promise<{ hasServerPat: boolean }>;
  clearServerPat: () => Promise<{ hasServerPat: boolean }>;
  setLogScope: (scope: 'all' | 'current') => void;
  selectRepo: (path: string) => void;
  selectCommit: (hash: string | null) => void;
  setView: (view: View) => void;
  setTheme: (mode: Theme) => void;
  setAccent: (accent: Accent) => void;
  toggleTheme: () => void;
  refreshRepos: () => Promise<RepoBrief[]>;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  runAction: <T>(action: Promise<T>, successMessage?: string) => Promise<T | null>;
}

// Exported so render tests can inject a mock context without booting the
// full provider (which performs network and local-storage side effects).
export const AppContext = createContext<AppData | null>(null);

// Assemble the domain contexts back into the aggregate AppData so `useApp()`
// keeps working unchanged until consumers migrate in Phase 2/3.
function LegacyAppBridge({ children }: { children: ReactNode }) {
  const prefs = usePreferences();
  const repo = useRepoData();
  const { runAction } = useRunAction();
  const busy = useBusy();
  const toast = useAppToast();

  const value = useMemo<AppData>(() => ({
    repos: repo.repos,
    activeRepo: repo.activeRepo,
    currentRepo: repo.activeRepo,
    activeBrief: repo.activeBrief,
    status: repo.status,
    commits: repo.commits,
    refs: repo.refs,
    remote: repo.remote,
    selectedHash: repo.selectedHash,
    view: prefs.view,
    theme: prefs.theme,
    accent: prefs.accent,
    pat: prefs.pat,
    hasServerPat: prefs.hasServerPat,
    busy,
    repoLoading: repo.repoLoading,
    logLimit: repo.logLimit,
    logScope: repo.logScope,
    logPath: repo.logPath,
    logFilters: repo.logFilters,
    toast,
    setPat: prefs.setPat,
    setServerPat: prefs.setServerPat,
    clearServerPat: prefs.clearServerPat,
    setLogScope: repo.setLogScope,
    setLogPath: repo.setLogPath,
    setLogFilters: repo.setLogFilters,
    selectRepo: repo.selectRepo,
    selectCommit: repo.selectCommit,
    setView: prefs.setView,
    setTheme: prefs.setTheme,
    setAccent: prefs.setAccent,
    toggleTheme: prefs.toggleTheme,
    refreshRepos: repo.refreshRepos,
    refresh: repo.refresh,
    loadMore: repo.loadMore,
    runAction,
  }), [repo, prefs, busy, toast, runAction]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  return (
    <PreferencesProvider>
      <RepoDataProvider>
        <ActionsProvider>
          <LegacyAppBridge>{children}</LegacyAppBridge>
        </ActionsProvider>
      </RepoDataProvider>
    </PreferencesProvider>
  );
}

export function useApp(): AppData {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppDataProvider');
  return ctx;
}
