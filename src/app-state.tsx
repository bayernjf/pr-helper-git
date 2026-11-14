import { errorMessage, errorDetail } from './lib/errors';
// Central application state: registry, active repo data, view switching,
// SSE-driven auto refresh and a helper that runs write actions then refreshes.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { getRefs,
  getRemote,
  getRepos,
  getStatus,
  getLog,
  getPatStatus,
  storeServerPat,
  deleteServerPat,
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
import { getPref, setPref } from './lib/prefs';
import { STORAGE_KEYS } from './lib/storage-keys';
import { applyAppearance, getAccent, getThemeMode, type Accent, type ThemeMode } from './lib/appearance';
import { t as translateText } from './i18n';

type View = 'git' | 'pr' | 'dashboard' | 'flows';
export type Theme = ThemeMode;
const ACTIVE_KEY = STORAGE_KEYS.activeRepo;
const PAT_KEY = STORAGE_KEYS.pat;
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

export function AppDataProvider({ children }: { children: ReactNode }) {
  const toastApi = useToast();
  const [repos, setRepos] = useState<RepoBrief[]>([]);
  const [activeRepo, setActiveRepo] = useState<string | null>(null);
  const [status, setStatus] = useState<ParsedStatus | null>(null);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [refs, setRefs] = useState<Ref[]>([]);
  const [remote, setRemote] = useState<RemoteInfo | null>(null);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [view, setViewState] = useState<View>(() => getPref<View>('view', 'git'));
  const [theme, setTheme] = useState<Theme>(() => getThemeMode());
  const [accent, setAccentState] = useState<Accent>(() => getAccent());
  const [pat, setPatState] = useState<string>(() => localStorage.getItem(PAT_KEY) || '');
  const [hasServerPat, setHasServerPat] = useState(false);
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

  const toast = useCallback(
    (message: string, kind: ToastKind = 'info') => toastApi.notify(message, kind),
    [toastApi],
  );

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
    // Server-side PAT availability gates the PR views alongside the
    // browser-local PAT (server-stored mode keeps no PAT in the browser).
    getPatStatus().then((s) => setHasServerPat(s.hasServerPat)).catch(() => undefined);
    return true;
  }, []);

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
    setRepoLoading(true);
    loadRepoData(repoPath, LOG_PAGE_SIZE, 'all', '')
      .catch((err) => {
        toastApi.error(errorMessage(err) || 'failed to load repository');
      })
      .finally(() => setRepoLoading(false));
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
    setRepoLoading(true);
    try {
      if (await loadRepoData(activeRepo, nextLimit, logScope, logPath, logFilters)) {
        setLogLimit(nextLimit);
      }
    } catch (err) {
      toastApi.error(errorMessage(err) || 'failed to load more history');
    } finally {
      setRepoLoading(false);
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

  const setPat = useCallback((value: string) => {
    setPatState(value);
    localStorage.setItem(PAT_KEY, value);
  }, []);
  const setServerPat = useCallback(async (value: string) => {
    const result = await storeServerPat(value);
    setHasServerPat(result.hasServerPat);
    // Server-stored mode: the browser copy is no longer needed.
    localStorage.removeItem(PAT_KEY);
    setPatState('');
    return result;
  }, []);
  const clearServerPat = useCallback(async () => {
    const result = await deleteServerPat();
    setHasServerPat(false);
    return result;
  }, []);

  // Persist the active view so a reload restores it.
  const setView = useCallback((next: View) => {
    setViewState(next);
    setPref('view', next);
  }, []);

  // Reflect mode + accent on <html>, persist them, and follow the OS while the
  // mode is "auto". main.tsx applies the saved values before first paint.
  useEffect(() => {
    applyAppearance(theme, accent);
    setPref('theme', theme);
    setPref('accent', accent);
    if (theme !== 'auto') return;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => applyAppearance('auto', accent);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme, accent]);

  const setAccent = useCallback((next: Accent) => setAccentState(next), []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : prev === 'light' ? 'auto' : 'dark'));
  }, []);

  // Switch the history scope and reload the active repo immediately. Keep the
  // path/author filters: the UI still shows them, so dropping them here would
  // silently display unfiltered history.
  const setLogScope = useCallback((scope: 'all' | 'current') => {
    setLogScopeState(scope);
    if (!activeRepo) return;
    setRepoLoading(true);
    loadRepoData(activeRepo, logLimit, scope, logPath, logFilters)
      .catch((err) => {
        toastApi.error(errorMessage(err) || 'failed to change history scope');
      })
      .finally(() => setRepoLoading(false));
  }, [activeRepo, loadRepoData, logLimit, logPath, logFilters, toastApi]);

  const setLogPath = useCallback((pathFilter: string) => {
    // Blur and Enter both apply the path; skip the reload when the value did
    // not actually change so the two events do not trigger duplicate requests.
    if (pathFilter === logPath) return;
    setLogPathState(pathFilter);
    if (!activeRepo) return;
    setRepoLoading(true);
    loadRepoData(activeRepo, logLimit, logScope, pathFilter, logFilters)
      .catch((err) => {
        toastApi.error(errorMessage(err) || 'failed to apply path filter');
      })
      .finally(() => setRepoLoading(false));
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
    setRepoLoading(true);
    loadRepoData(activeRepo, logLimit, logScope, logPath, next)
      .catch((err) => {
        toastApi.error(errorMessage(err) || 'failed to apply history filters');
      })
      .finally(() => setRepoLoading(false));
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
      view,
      theme,
      accent,
      pat,
      hasServerPat,
      busy,
      repoLoading,
      logLimit,
      logScope,
      logPath,
      logFilters,
      toast,
      setPat,
      setServerPat,
      clearServerPat,
      setLogScope,
      setLogPath,
      setLogFilters,
      selectRepo,
      selectCommit: setSelectedHash,
      setView,
      setTheme,
      setAccent,
      toggleTheme,
      refreshRepos,
      refresh,
      loadMore,
      runAction,
    };
  }, [
    repos, activeRepo, status, commits, refs, remote, selectedHash, view,
    theme, accent, pat, busy, repoLoading, logLimit, logScope, logPath, logFilters,
    toast, setPat, setLogScope,
    setLogPath, setLogFilters, selectRepo, refreshRepos, refresh, loadMore,
    runAction, toggleTheme, setAccent,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppData {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppDataProvider');
  return ctx;
}