import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Context, ReactNode } from 'react';
import { errorMessage } from '../lib/errors';
import { getRefs, getRemote, getRepos, getStatus, getLog } from '../api';
import type { LogFilters } from '../types';
import { useToast } from '../components/ui';
import { STORAGE_KEYS } from '../lib/storage-keys';
import type {
  ActiveRepoState,
  RepoData,
  RepoHistoryState,
  RepoRefsState,
  RepoRegistry,
  RepoStatusState,
} from './types';
import { usePreferences } from './preferences-provider';

const ACTIVE_KEY = STORAGE_KEYS.activeRepo;
const LOG_PAGE_SIZE = 200;
export const LOG_MAX = 1000;

// Exported so render tests can inject a mock context without booting the full
// provider (which performs network and local-storage side effects).
export const RepoDataContext = createContext<RepoData | null>(null);
// Finer contexts keep the hot SSE payload away from UI that only needs the
// active path or a registry refresh.
export const RepoRegistryContext = createContext<RepoRegistry | null>(null);
export const ActiveRepoContext = createContext<ActiveRepoState | null>(null);
export const ActiveBriefContext = createContext<RepoData['activeBrief'] | undefined>(undefined);
export const RepoStatusContext = createContext<RepoStatusState | null>(null);
export const RepoRefsContext = createContext<RepoRefsState | null>(null);
export const RepoHistoryContext = createContext<RepoHistoryState | null>(null);

const StableChildren = memo(function StableChildren({ children }: { children: ReactNode }) {
  return <>{children}</>;
});

export function RepoDataProvider({ children }: { children: ReactNode }) {
  const toastApi = useToast();
  const { refreshServerPat } = usePreferences();

  const [repos, setRepos] = useState<RepoData['repos']>([]);
  // False until the first registry load resolves; consumers use it to tell
  // 'still loading' apart from 'no repositories at all'.
  const [reposLoaded, setReposLoaded] = useState(false);
  const [activeRepo, setActiveRepo] = useState<string | null>(null);
  const [status, setStatus] = useState<RepoData['status']>(null);
  const [commits, setCommits] = useState<RepoData['commits']>([]);
  const [refs, setRefs] = useState<RepoData['refs']>([]);
  const [remote, setRemote] = useState<RepoData['remote']>(null);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [repoLoading, setRepoLoading] = useState(false);
  // Mirror for non-React readers (the SSE listener) that must skip while a
  // user-initiated load is in flight.
  const repoLoadingRef = useRef(false);
  useEffect(() => { repoLoadingRef.current = repoLoading; }, [repoLoading]);
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
    setReposLoaded(true);
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

  const refreshImpl = useCallback(async () => {
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
  const refreshImplRef = useRef(refreshImpl);
  refreshImplRef.current = refreshImpl;
  // Stable identity: registry consumers (modals with a Refresh button) must
  // not re-render when the user changes a log filter or switches repositories.
  const refresh = useCallback(() => refreshImplRef.current(), []);

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
          // Skip while a user-initiated load is in flight: that load fetches
          // fresh data anyway, and an interleaved background reload would
          // bump the load seq past it, leaving the loading bar stuck.
          if (repoLoadingRef.current) return;
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

  const registry = useMemo<RepoRegistry>(() => ({
    repos,
    reposLoaded,
    refreshRepos,
    refresh,
  }), [repos, reposLoaded, refreshRepos, refresh]);

  const active = useMemo<ActiveRepoState>(() => ({ activeRepo, selectRepo }), [activeRepo, selectRepo]);

  const activeBrief = useMemo(
    () => repos.find((r) => r.path === activeRepo) || null,
    [repos, activeRepo],
  );

  const statusSlice = useMemo<RepoStatusState>(() => ({ status, repoLoading }), [status, repoLoading]);

  const refsSlice = useMemo<RepoRefsState>(() => ({ refs, remote }), [refs, remote]);

  const history = useMemo<RepoHistoryState>(() => ({
    commits,
    selectedHash,
    logLimit,
    logScope,
    logPath,
    logFilters,
    setLogPath,
    setLogFilters,
    setLogScope,
    selectCommit: setSelectedHash,
    loadMore,
  }), [
    commits, selectedHash, logLimit, logScope, logPath, logFilters,
    setLogPath, setLogFilters, setLogScope, loadMore,
  ]);

  // Compatibility aggregate for tests and any consumer that has not migrated
  // yet. Production components subscribe to the slice contexts above so an
  // SSE commit refresh does not re-render path-only modals.
  const value = useMemo<RepoData>(() => ({
    ...registry,
    ...active,
    activeBrief,
    ...statusSlice,
    ...refsSlice,
    ...history,
  }), [registry, active, activeBrief, statusSlice, refsSlice, history]);

  return (
    <RepoDataContext.Provider value={value}>
      <RepoRegistryContext.Provider value={registry}>
        <ActiveRepoContext.Provider value={active}>
          <ActiveBriefContext.Provider value={activeBrief}>
            <RepoStatusContext.Provider value={statusSlice}>
              <RepoRefsContext.Provider value={refsSlice}>
                <RepoHistoryContext.Provider value={history}>
                  <StableChildren>{children}</StableChildren>
                </RepoHistoryContext.Provider>
              </RepoRefsContext.Provider>
            </RepoStatusContext.Provider>
          </ActiveBriefContext.Provider>
        </ActiveRepoContext.Provider>
      </RepoRegistryContext.Provider>
    </RepoDataContext.Provider>
  );
}

export function useRepoData(): RepoData {
  const ctx = useContext(RepoDataContext);
  if (!ctx) throw new Error('useRepoData must be used inside RepoDataProvider');
  return ctx;
}

// Slice hooks fall back to the aggregate context so render tests that inject
// one flat RepoDataContext keep working. Production trees always provide the
// slice contexts and therefore avoid the aggregate re-render.
const selectRegistry = (d: RepoData): RepoRegistry => ({
  repos: d.repos,
  reposLoaded: d.reposLoaded,
  refreshRepos: d.refreshRepos,
  refresh: d.refresh,
});
const selectActive = (d: RepoData): ActiveRepoState => ({
  activeRepo: d.activeRepo,
  selectRepo: d.selectRepo,
});
const selectStatus = (d: RepoData): RepoStatusState => ({
  status: d.status,
  repoLoading: d.repoLoading,
});
const selectRefs = (d: RepoData): RepoRefsState => ({ refs: d.refs, remote: d.remote });
const selectHistory = (d: RepoData): RepoHistoryState => ({
  commits: d.commits,
  selectedHash: d.selectedHash,
  logLimit: d.logLimit,
  logScope: d.logScope,
  logPath: d.logPath,
  logFilters: d.logFilters,
  setLogPath: d.setLogPath,
  setLogFilters: d.setLogFilters,
  setLogScope: d.setLogScope,
  selectCommit: d.selectCommit,
  loadMore: d.loadMore,
});

function useRepoSlice<T>(
  ctx: Context<T | null>,
  select: (data: RepoData) => T,
  name: string,
): T {
  const slice = useContext(ctx);
  // A provided slice is the normal path: return before reading the aggregate
  // context, otherwise every slice consumer would subscribe to all repo data
  // again and the split would not reduce re-renders. Provider presence is
  // static for the lifetime of a tree, so the fallback branch is only taken by
  // tests that inject one flat RepoDataContext.
  if (slice !== null) return slice;
  const full = useContext(RepoDataContext);
  const fallback = useMemo(() => (full ? select(full) : null), [full, select]);
  if (fallback === null) throw new Error(`${name} must be used inside RepoDataProvider`);
  return fallback;
}

export function useRepoRegistry(): RepoRegistry {
  return useRepoSlice(RepoRegistryContext, selectRegistry, 'useRepoRegistry');
}

export function useActiveRepo(): ActiveRepoState {
  return useRepoSlice(ActiveRepoContext, selectActive, 'useActiveRepo');
}

export function useActiveBrief(): RepoData['activeBrief'] {
  const slice = useContext(ActiveBriefContext);
  if (slice !== undefined) return slice;
  const full = useContext(RepoDataContext);
  if (!full) throw new Error('useActiveBrief must be used inside RepoDataProvider');
  return full.activeBrief;
}

export function useRepoStatus(): RepoStatusState {
  return useRepoSlice(RepoStatusContext, selectStatus, 'useRepoStatus');
}

export function useRepoRefs(): RepoRefsState {
  return useRepoSlice(RepoRefsContext, selectRefs, 'useRepoRefs');
}

export function useRepoHistory(): RepoHistoryState {
  return useRepoSlice(RepoHistoryContext, selectHistory, 'useRepoHistory');
}
