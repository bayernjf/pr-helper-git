import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { errorMessage } from '../lib/errors';
import { getRefs, getRemote, getRepos, getStatus, getLog } from '../api';
import type { LogFilters } from '../types';
import { useToast } from '../components/ui';
import { STORAGE_KEYS } from '../lib/storage-keys';
import type { RepoData } from './types';
import { usePreferences } from './preferences-provider';

const ACTIVE_KEY = STORAGE_KEYS.activeRepo;
const LOG_PAGE_SIZE = 200;
export const LOG_MAX = 1000;

// Exported so render tests can inject a mock context without booting the full
// provider (which performs network and local-storage side effects).
export const RepoDataContext = createContext<RepoData | null>(null);

export function RepoDataProvider({ children }: { children: ReactNode }) {
  const toastApi = useToast();
  const { refreshServerPat } = usePreferences();

  const [repos, setRepos] = useState<RepoData['repos']>([]);
  const [activeRepo, setActiveRepo] = useState<string | null>(null);
  const [status, setStatus] = useState<RepoData['status']>(null);
  const [commits, setCommits] = useState<RepoData['commits']>([]);
  const [refs, setRefs] = useState<RepoData['refs']>([]);
  const [remote, setRemote] = useState<RepoData['remote']>(null);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
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

  const value = useMemo<RepoData>(() => {
    const activeBrief = repos.find((r) => r.path === activeRepo) || null;
    return {
      repos,
      activeRepo,
      activeBrief,
      status,
      commits,
      refs,
      remote,
      selectedHash,
      repoLoading,
      logLimit,
      logScope,
      logPath,
      logFilters,
      setLogPath,
      setLogFilters,
      setLogScope,
      selectRepo,
      selectCommit: setSelectedHash,
      refreshRepos,
      refresh,
      loadMore,
    };
  }, [
    repos, activeRepo, status, commits, refs, remote, selectedHash, repoLoading,
    logLimit, logScope, logPath, logFilters,
    setLogPath, setLogFilters, setLogScope, selectRepo, refreshRepos, refresh, loadMore,
  ]);

  return <RepoDataContext.Provider value={value}>{children}</RepoDataContext.Provider>;
}

export function useRepoData(): RepoData {
  const ctx = useContext(RepoDataContext);
  if (!ctx) throw new Error('useRepoData must be used inside RepoDataProvider');
  return ctx;
}
