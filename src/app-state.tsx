import { errorMessage, errorDetail } from './lib/errors';
// Central application state: registry, active repo data, view switching,
// SSE-driven auto refresh and a helper that runs write actions then refreshes.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  getRefs,
  getRemote,
  getRepos,
  getStatus,
  getLog,
} from './api';
import type {
  Commit,
  LogFilters,
  ParsedStatus,
  Ref,
  RemoteInfo,
  RepoBrief,
} from './types';
import { useToast, type ToastKind } from './components/ui';
import { STORAGE_KEYS } from './lib/storage-keys';
import type { Accent } from './lib/appearance';
import { t as translateText } from './i18n';
import type { Theme, View } from './app-state/types';
import { PreferencesProvider, usePreferences } from './app-state/preferences-provider';
import { useAppToast } from './app-state/toast';

const ACTIVE_KEY = STORAGE_KEYS.activeRepo;
const LOG_PAGE_SIZE = 200;
export const LOG_MAX = 1000;

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

// The repo-data and write-action state lives here until S1b/S1c split it into
// RepoDataProvider / ActionsProvider. Preferences have already moved out to
// PreferencesProvider; this inner component reads them back and assembles the
// aggregate AppData so `useApp()` keeps working unchanged.
function AppDataInner({ children }: { children: ReactNode }) {
  const toastApi = useToast();
  const prefs = usePreferences();
  const refreshServerPat = prefs.refreshServerPat;
  const toast = useAppToast();

  const [repos, setRepos] = useState<RepoBrief[]>([]);
  const [activeRepo, setActiveRepo] = useState<string | null>(null);
  const [status, setStatus] = useState<ParsedStatus | null>(null);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [refs, setRefs] = useState<Ref[]>([]);
  const [remote, setRemote] = useState<RemoteInfo | null>(null);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [repoLoading, setRepoLoading] = useState(false);
  const [logLimit, setLogLimit] = useState(LOG_PAGE_SIZE);
  const [logScope, setLogScopeState] = useState<'all' | 'current'>('all');
  const [logPath, setLogPathState] = useState('');
  const [logFilters, setLogFiltersState] = useState<LogFilters>({});

  // Every load belongs to a request generation. Switching repositories (or
  // firing a newer refresh) bumps it, so a slow response from the previous
  // repository can no longer overwrite the data of the current one.
  const activeRepoRef = useRef<string | null>(null);
  const loadSeqRef = useRef(0);

  const refreshRepos = useCallback(async () => {
    const { repos: list } = await getRepos();
    setRepos(list);
    return list;
  }, []);

  const loadRepoData = useCallback(async (
    repoPath: string,
    limit: number = LOG_PAGE_SIZE,
    scope: 'all' | 'current' = 'all',
    pathFilter: string = '',
    filters: LogFilters = {},
  ) => {
    const seq = ++loadSeqRef.current;
    const [statusRes, logRes, refsRes, remoteRes] = await Promise.all([
      getStatus(repoPath),
      getLog(repoPath, limit, scope, pathFilter || undefined, filters),
      getRefs(repoPath),
      getRemote(repoPath),
    ]);
    // Drop the result when a newer load started or the user moved to another
    // repository while these requests were in flight.
    if (seq !== loadSeqRef.current || repoPath !== activeRepoRef.current) return false;
    // The operation state is a sibling of the porcelain payload in the API
    // response; attach it so components can read status.state.
    setStatus({ ...statusRes.status, state: statusRes.state });
    setCommits(logRes.commits);
    setRefs(refsRes.refs);
    setRemote(remoteRes.remote);
    // Server-side PAT availability gates the PR views alongside the browser-
    // local PAT (server-stored mode keeps no PAT in the browser). Re-read it
    // after each repo load (fire-and-forget), unchanged from the original.
    refreshServerPat();
    return true;
  }, [refreshServerPat]);

  const selectRepo = useCallback((repoPath: string) => {
    activeRepoRef.current = repoPath;
    setActiveRepo(repoPath);
    localStorage.setItem(ACTIVE_KEY, repoPath);
    setSelectedHash(null);
    // Clear the previous repository's data immediately so the graph/detail
    // panes never show stale commits under the new repository name.
    setStatus(null);
    setCommits([]);
    setRefs([]);
    setRemote(null);
    setLogLimit(LOG_PAGE_SIZE);
    setLogScopeState('all');
    setLogPathState('');
    setLogFiltersState({});
    const seq = loadSeqRef.current + 1;
    setRepoLoading(true);
    loadRepoData(repoPath, LOG_PAGE_SIZE, 'all', '')
      .catch((err) => {
        toastApi.error(errorMessage(err) || 'failed to load repository');
      })
      .finally(() => { if (seq === loadSeqRef.current) setRepoLoading(false); });
  }, [loadRepoData, toastApi]);

  const refresh = useCallback(async () => {
    const list = await refreshRepos();
    if (activeRepo) {
      if (!list.some((r) => r.path === activeRepo)) {
        activeRepoRef.current = null;
        setActiveRepo(null);
        setStatus(null);
        setCommits([]);
        setRefs([]);
        setRemote(null);
        setSelectedHash(null);
        return;
      }
      await loadRepoData(activeRepo, logLimit, logScope, logPath, logFilters);
    }
  }, [activeRepo, loadRepoData, logLimit, logScope, logPath, logFilters, refreshRepos]);

  // Grow the loaded history window one page at a time up to LOG_MAX.
  const loadMore = useCallback(async () => {
    if (!activeRepo) return;
    const nextLimit = Math.min(logLimit + LOG_PAGE_SIZE, LOG_MAX);
    if (nextLimit === logLimit) return;
    const seq = loadSeqRef.current + 1;
    setRepoLoading(true);
    try {
      if (await loadRepoData(activeRepo, nextLimit, logScope, logPath, logFilters)) {
        setLogLimit(nextLimit);
      }
    } catch (err) {
      toastApi.error(errorMessage(err) || 'failed to load more history');
    } finally {
      if (seq === loadSeqRef.current) setRepoLoading(false);
    }
  }, [activeRepo, logLimit, logScope, logPath, logFilters, loadRepoData, toastApi]);

  // Initial load: restore the last active repo when still registered.
  useEffect(() => {
    (async () => {
      const list = await refreshRepos();
      const remembered = localStorage.getItem(ACTIVE_KEY);
      const target = list.find((r) => r.path === remembered) || list[0];
      if (target) selectRepo(target.path);
    })().catch((err) => toastApi.error(errorMessage(err)));
  }, [refreshRepos, selectRepo, toastApi]);

  // Keep the latest reload parameters in a ref so the EventSource can be
  // opened once and never torn down when log options change, which otherwise
  // creates a window where change frames are missed.
  const sseParamsRef = useRef({ activeRepo, logLimit, logScope, logPath, logFilters });
  sseParamsRef.current = { activeRepo, logLimit, logScope, logPath, logFilters };

  // SSE: silently reload the active repo when its files change.
  useEffect(() => {
    const source = new EventSource('/api/events');
    source.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        const params = sseParamsRef.current;
        const repoPath = params.activeRepo;
        if (repoPath && data.type === 'repo-changed' && data.path === repoPath) {
          loadRepoData(repoPath, params.logLimit, params.logScope, params.logPath, params.logFilters)
            .catch(() => {});
        }
      } catch {
        /* ignore malformed frames */
      }
    });
    return () => source.close();
  }, [loadRepoData]);

  // Switch the history scope and reload the active repo immediately. Keep the
  // path/author filters: the UI still shows them, so dropping them here would
  // silently display unfiltered history.
  const setLogScope = useCallback((scope: 'all' | 'current') => {
    setLogScopeState(scope);
    if (!activeRepo) return;
    const seq = loadSeqRef.current + 1;
    setRepoLoading(true);
    loadRepoData(activeRepo, logLimit, scope, logPath, logFilters)
      .catch((err) => {
        toastApi.error(errorMessage(err) || 'failed to change history scope');
      })
      .finally(() => { if (seq === loadSeqRef.current) setRepoLoading(false); });
  }, [activeRepo, loadRepoData, logLimit, logPath, logFilters, toastApi]);

  const setLogPath = useCallback((pathFilter: string) => {
    // Blur and Enter both apply the path; skip the reload when the value did
    // not actually change so the two events do not trigger duplicate requests.
    if (pathFilter === logPath) return;
    setLogPathState(pathFilter);
    if (!activeRepo) return;
    const seq = loadSeqRef.current + 1;
    setRepoLoading(true);
    loadRepoData(activeRepo, logLimit, logScope, pathFilter, logFilters)
      .catch((err) => {
        toastApi.error(errorMessage(err) || 'failed to apply path filter');
      })
      .finally(() => { if (seq === loadSeqRef.current) setRepoLoading(false); });
  }, [activeRepo, loadRepoData, logLimit, logScope, logPath, logFilters, toastApi]);

  // Apply server-side history filters. Empty fields are dropped so an empty
  // filter object restores the unfiltered commit list.
  const setLogFilters = useCallback((filters: LogFilters) => {
    const next: LogFilters = {};
    for (const [key, value] of Object.entries(filters)) {
      const v = String(value || '').trim();
      if (v) (next as Record<string, string>)[key] = v;
    }
    setLogFiltersState(next);
    if (!activeRepo) return;
    const seq = loadSeqRef.current + 1;
    setRepoLoading(true);
    loadRepoData(activeRepo, logLimit, logScope, logPath, next)
      .catch((err) => {
        toastApi.error(errorMessage(err) || 'failed to apply history filters');
      })
      .finally(() => { if (seq === loadSeqRef.current) setRepoLoading(false); });
  }, [activeRepo, loadRepoData, logLimit, logScope, logPath, toastApi]);

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

  const value = useMemo<AppData>(() => {
    const activeBrief = repos.find((r) => r.path === activeRepo) || null;
    return {
      repos,
      activeRepo,
      currentRepo: activeRepo,
      activeBrief,
      status,
      commits,
      refs,
      remote,
      selectedHash,
      view: prefs.view,
      theme: prefs.theme,
      accent: prefs.accent,
      pat: prefs.pat,
      hasServerPat: prefs.hasServerPat,
      busy,
      repoLoading,
      logLimit,
      logScope,
      logPath,
      logFilters,
      toast,
      setPat: prefs.setPat,
      setServerPat: prefs.setServerPat,
      clearServerPat: prefs.clearServerPat,
      setLogScope,
      setLogPath,
      setLogFilters,
      selectRepo,
      selectCommit: setSelectedHash,
      setView: prefs.setView,
      setTheme: prefs.setTheme,
      setAccent: prefs.setAccent,
      toggleTheme: prefs.toggleTheme,
      refreshRepos,
      refresh,
      loadMore,
      runAction,
    };
  }, [
    repos, activeRepo, status, commits, refs, remote, selectedHash,
    prefs.view, prefs.theme, prefs.accent, prefs.pat, prefs.hasServerPat,
    busy, repoLoading, logLimit, logScope, logPath, logFilters,
    toast, prefs.setPat, prefs.setServerPat, prefs.clearServerPat,
    setLogScope, setLogPath, setLogFilters, selectRepo,
    prefs.setView, prefs.setTheme, prefs.setAccent, prefs.toggleTheme,
    refreshRepos, refresh, loadMore, runAction,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  return (
    <PreferencesProvider>
      <AppDataInner>{children}</AppDataInner>
    </PreferencesProvider>
  );
}

export function useApp(): AppData {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppDataProvider');
  return ctx;
}
