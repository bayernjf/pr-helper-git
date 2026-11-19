import { errorMessage, errorDetail } from './lib/errors';
// Central application state: registry, active repo data, view switching,
// SSE-driven auto refresh and a helper that runs write actions then refreshes.
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  Commit,
  LogFilters,
  ParsedStatus,
  Ref,
  RemoteInfo,
  RepoBrief,
} from './types';
import { useToast, type ToastKind } from './components/ui';
import type { Accent } from './lib/appearance';
import { t as translateText } from './i18n';
import type { Theme, View } from './app-state/types';
import { PreferencesProvider, usePreferences } from './app-state/preferences-provider';
import { RepoDataProvider, useRepoData } from './app-state/repo-provider';
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

// The write-action (busy/runAction) state lives here until S1c splits it into
// ActionsProvider. Preferences and repo data have already moved out to their
// own providers; this inner component reads them back and assembles the
// aggregate AppData so `useApp()` keeps working unchanged.
function AppDataInner({ children }: { children: ReactNode }) {
  const toastApi = useToast();
  const prefs = usePreferences();
  const repo = useRepoData();
  const refresh = repo.refresh;
  const toast = useAppToast();

  const [busy, setBusy] = useState(false);

  // Run a write action, then refresh all data. Errors are surfaced as toasts.
  const runAction = useCallback(async <T,>(action: Promise<T>, successMessage?: string) => {
    setBusy(true);
    try {
      const result = await action;
      await refresh();
      if (successMessage) toastApi.notify(successMessage, 'success');
      return result;
    } catch (err) {
      // A failed write can still change the repository (conflicted merge,
      // revert or rebase), so reload before reporting the error; otherwise
      // the operation banner and unmerged files would not appear.
      try { await refresh(); } catch { /* surfaced by the original error */ }
      const message = errorDetail(err)
        ? `${translateText(errorMessage(err) || 'action failed')}: ${errorDetail(err)}`
        : translateText(errorMessage(err) || 'action failed');
      toastApi.error(message);
      return null;
    } finally {
      setBusy(false);
    }
  }, [refresh, toastApi]);

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
    refresh,
    loadMore: repo.loadMore,
    runAction,
  }), [repo, prefs, busy, toast, refresh, runAction]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  return (
    <PreferencesProvider>
      <RepoDataProvider>
        <AppDataInner>{children}</AppDataInner>
      </RepoDataProvider>
    </PreferencesProvider>
  );
}

export function useApp(): AppData {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppDataProvider');
  return ctx;
}
