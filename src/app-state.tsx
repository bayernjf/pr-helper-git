// Central application state: registry, active repo data, view switching and
// a helper that runs a write action and refreshes every affected view.
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
  ParsedStatus,
  Ref,
  RemoteInfo,
  RepoBrief,
} from './types';
import { useToast } from './components/ui';

type View = 'git' | 'pr';
const ACTIVE_KEY = 'git2-active-repo';
const PAT_KEY = 'git2-pat';

interface AppData {
  repos: RepoBrief[];
  activeRepo: string | null;
  activeBrief: RepoBrief | null;
  status: ParsedStatus | null;
  commits: Commit[];
  refs: Ref[];
  remote: RemoteInfo | null;
  selectedHash: string | null;
  view: View;
  pat: string;
  busy: boolean;
  setPat: (value: string) => void;
  selectRepo: (path: string) => void;
  selectCommit: (hash: string | null) => void;
  setView: (view: View) => void;
  refreshRepos: () => Promise<RepoBrief[]>;
  refresh: () => Promise<void>;
  runAction: <T>(action: Promise<T>, successMessage?: string) => Promise<T | null>;
}

const AppContext = createContext<AppData | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
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

  const refreshRepos = useCallback(async () => {
    const { repos: list } = await getRepos();
    setRepos(list);
    return list;
  }, []);

  const loadRepoData = useCallback(async (repoPath: string) => {
    const [statusRes, logRes, refsRes, remoteRes] = await Promise.all([
      getStatus(repoPath),
      getLog(repoPath),
      getRefs(repoPath),
      getRemote(repoPath),
    ]);
    setStatus(statusRes.status);
    setCommits(logRes.commits);
    setRefs(refsRes.refs);
    setRemote(remoteRes.remote);
  }, []);

  const selectRepo = useCallback((repoPath: string) => {
    setActiveRepo(repoPath);
    localStorage.setItem(ACTIVE_KEY, repoPath);
    setSelectedHash(null);
    loadRepoData(repoPath).catch((err) => {
      toast.error(err.message || 'failed to load repository');
    });
  }, [loadRepoData, toast]);

  const refresh = useCallback(async () => {
    const list = await refreshRepos();
    if (activeRepo) {
      if (!list.some((r) => r.path === activeRepo)) {
        setActiveRepo(null);
        return;
      }
      await loadRepoData(activeRepo);
    }
  }, [activeRepo, loadRepoData, refreshRepos]);

  // Initial load: restore the last active repo when still registered.
  useEffect(() => {
    (async () => {
      const list = await refreshRepos();
      const remembered = localStorage.getItem(ACTIVE_KEY);
      const target = list.find((r) => r.path === remembered) || list[0];
      if (target) selectRepo(target.path);
    })().catch((err) => toast.error(err.message));
  }, [refreshRepos, selectRepo, toast]);

  const setPat = useCallback((value: string) => {
    setPatState(value);
    localStorage.setItem(PAT_KEY, value);
  }, []);

  // Run a write action, then refresh all data. Errors are surfaced as toasts.
  const runAction = useCallback(async <T,>(action: Promise<T>, successMessage?: string) => {
    setBusy(true);
    try {
      const result = await action;
      await refresh();
      if (successMessage) toast.notify(successMessage, 'success');
      return result;
    } catch (err: any) {
      const message = err?.detail ? `${err.message}: ${err.detail}` : err?.message || 'action failed';
      toast.error(message);
      return null;
    } finally {
      setBusy(false);
    }
  }, [refresh, toast]);

  const value = useMemo<AppData>(() => {
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
      view,
      pat,
      busy,
      setPat,
      selectRepo,
      selectCommit: setSelectedHash,
      setView,
      refreshRepos,
      refresh,
      runAction,
    };
  }, [
    repos, activeRepo, status, commits, refs, remote, selectedHash, view,
    pat, busy, setPat, selectRepo, refreshRepos, refresh, runAction,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppData {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppDataProvider');
  return ctx;
}
