// Central application state: registry, active repo data, view switching,
// SSE-driven auto refresh and a helper that runs write actions then refreshes.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
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

type View = 'git' | 'pr';
const ACTIVE_KEY = 'git2-active-repo';
const PAT_KEY = 'git2-pat';
export const LOG_PAGE_SIZE = 200;
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
  pat: string;
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
  setLogScope: (scope: 'all' | 'current') => void;
  selectRepo: (path: string) => void;
  selectCommit: (hash: string | null) => void;
  setView: (view: View) => void;
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
  const [view, setView] = useState<View>('git');
  const [pat, setPatState] = useState<string>(() => localStorage.getItem(PAT_KEY) || '');
  const [busy, setBusy] = useState(false);
  const [repoLoading, setRepoLoading] = useState(false);
  const [logLimit, setLogLimit] = useState(LOG_PAGE_SIZE);
  const [logScope, setLogScopeState] = useState<'all' | 'current'>('all');
  const [logPath, setLogPathState] = useState('');
  const [logFilters, setLogFiltersState] = useState<LogFilters>({});

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
    const [statusRes, logRes, refsRes, remoteRes] = await Promise.all([
      getStatus(repoPath),
      getLog(repoPath, limit, scope, pathFilter || undefined, filters),
      getRefs(repoPath),
      getRemote(repoPath),
    ]);
    // The operation state is a sibling of the porcelain payload in the API
    // response; attach it so components can read status.state.
    setStatus({ ...statusRes.status, state: statusRes.state });
    setCommits(logRes.commits);
    setRefs(refsRes.refs);
    setRemote(remoteRes.remote);
  }, []);

  const selectRepo = useCallback((repoPath: string) => {
    setActiveRepo(repoPath);
    localStorage.setItem(ACTIVE_KEY, repoPath);
    setSelectedHash(null);
    setLogLimit(LOG_PAGE_SIZE);
    setLogScopeState('all');
    setLogPathState('');
    setLogFiltersState({});
    setRepoLoading(true);
    loadRepoData(repoPath, LOG_PAGE_SIZE, 'all', '')
      .catch((err) => {
        toastApi.error(err.message || 'failed to load repository');
      })
      .finally(() => setRepoLoading(false));
  }, [loadRepoData, toastApi]);

  const refresh = useCallback(async () => {
    const list = await refreshRepos();
    if (activeRepo) {
      if (!list.some((r) => r.path === activeRepo)) {
        setActiveRepo(null);
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
      await loadRepoData(activeRepo, nextLimit, logScope, logPath, logFilters);
      setLogLimit(nextLimit);
    } catch (err) {
      toastApi.error((err as any)?.message || 'failed to load more history');
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
    })().catch((err) => toastApi.error(err.message));
  }, [refreshRepos, selectRepo, toastApi]);

  // SSE: silently reload the active repo when its files change.
  useEffect(() => {
    const source = new EventSource('/api/events');
    source.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        const repoPath = activeRepo;
        if (repoPath && data.type === 'repo-changed' && data.path === repoPath) {
          loadRepoData(repoPath, logLimit, logScope, logPath, logFilters).catch(() => {});
        }
      } catch {
        /* ignore malformed frames */
      }
    });
    return () => source.close();
  }, [activeRepo, loadRepoData, logLimit, logScope, logPath, logFilters]);

  const setPat = useCallback((value: string) => {
    setPatState(value);
    localStorage.setItem(PAT_KEY, value);
  }, []);

  // Switch the history scope and reload the active repo immediately.
  const setLogScope = useCallback((scope: 'all' | 'current') => {
    setLogScopeState(scope);
    if (!activeRepo) return;
    setRepoLoading(true);
    loadRepoData(activeRepo, logLimit, scope)
      .catch((err) => {
        toastApi.error((err as any)?.message || 'failed to change history scope');
      })
      .finally(() => setRepoLoading(false));
  }, [activeRepo, loadRepoData, logLimit, toastApi]);

  const setLogPath = useCallback((pathFilter: string) => {
    setLogPathState(pathFilter);
    if (!activeRepo) return;
    setRepoLoading(true);
    loadRepoData(activeRepo, logLimit, logScope, pathFilter, logFilters)
      .catch((err) => {
        toastApi.error((err as any)?.message || 'failed to apply path filter');
      })
      .finally(() => setRepoLoading(false));
  }, [activeRepo, loadRepoData, logLimit, logScope, logFilters, toastApi]);

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
        toastApi.error((err as any)?.message || 'failed to apply history filters');
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
    } catch (err: any) {
      const message = err?.detail ? `${err.message}: ${err.detail}` : err?.message || 'action failed';
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
      pat,
      busy,
      repoLoading,
      logLimit,
      logScope,
      logPath,
      logFilters,
      toast,
      setPat,
      setLogScope,
      setLogPath,
      setLogFilters,
      selectRepo,
      selectCommit: setSelectedHash,
      setView,
      refreshRepos,
      refresh,
      loadMore,
      runAction,
    };
  }, [
    repos, activeRepo, status, commits, refs, remote, selectedHash, view,
    pat, busy, repoLoading, logLimit, logScope, logPath, logFilters, toast, setPat, setLogScope,
    setLogPath, setLogFilters, selectRepo, refreshRepos, refresh, loadMore, runAction,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppData {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppDataProvider');
  return ctx;
}
