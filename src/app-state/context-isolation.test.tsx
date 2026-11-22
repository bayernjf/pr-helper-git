// @vitest-environment jsdom
// Prove the split contexts are isolated: changing one domain's state must not
// re-render consumers of another domain. Render counts come from probe
// components that each subscribe to exactly one hook.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDataProvider } from '../app-state';
import { ToastProvider } from '../components/ui';
import {
  useActiveBrief,
  useActiveRepo,
  useBusy,
  usePreferences,
  useRepoData,
  useRepoHistory,
  useRepoRefs,
  useRepoRegistry,
  useRepoStatus,
  useRunAction,
} from './hooks';

vi.mock('../api', () => ({
  getRepos: vi.fn(() => Promise.resolve({ repos: [] })),
  getStatus: vi.fn(() => Promise.resolve({ status: {}, state: 'clean' })),
  getLog: vi.fn(() => Promise.resolve({ commits: [] })),
  getRefs: vi.fn(() => Promise.resolve({ refs: [] })),
  getRemote: vi.fn(() => Promise.resolve({ remote: null })),
  getPatStatus: vi.fn(() => Promise.resolve({ hasServerPat: false })),
  storeServerPat: vi.fn(() => Promise.resolve({ hasServerPat: true })),
  deleteServerPat: vi.fn(() => Promise.resolve({ hasServerPat: false })),
}));

// jsdom has no EventSource; the repo provider opens one on mount.
class MockEventSource {
  close() {}
  addEventListener() {}
}
(globalThis as unknown as { EventSource?: unknown }).EventSource =
  MockEventSource as unknown as typeof EventSource;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let repoRenders = 0;
let prefsRenders = 0;
let actionRenders = 0;
let busyRenders = 0;
let activeRenders = 0;
let registryRenders = 0;
let statusRenders = 0;
let refsRenders = 0;
let historyRenders = 0;
let briefRenders = 0;

function RepoProbe() {
  useRepoData();
  repoRenders += 1;
  return null;
}
function PrefsProbe() {
  usePreferences();
  prefsRenders += 1;
  return null;
}
function RunActionProbe() {
  useRunAction();
  actionRenders += 1;
  return null;
}
function BusyProbe() {
  useBusy();
  busyRenders += 1;
  return null;
}
function ActiveProbe() {
  useActiveRepo();
  activeRenders += 1;
  return null;
}
function RegistryProbe() {
  useRepoRegistry();
  registryRenders += 1;
  return null;
}
function StatusProbe() {
  useRepoStatus();
  statusRenders += 1;
  return null;
}
function RefsProbe() {
  useRepoRefs();
  refsRenders += 1;
  return null;
}
function HistoryProbe() {
  useRepoHistory();
  historyRenders += 1;
  return null;
}
function BriefProbe() {
  useActiveBrief();
  briefRenders += 1;
  return null;
}

type Prefs = ReturnType<typeof usePreferences>;
type Repo = ReturnType<typeof useRepoData>;
type Acts = ReturnType<typeof useRunAction>;

const setters: {
  setTheme?: Prefs['setTheme'];
  setPat?: Prefs['setPat'];
  setLogFilters?: Repo['setLogFilters'];
  selectCommit?: Repo['selectCommit'];
  runAction?: Acts['runAction'];
} = {};

function Harness() {
  const prefs = usePreferences();
  const repo = useRepoData();
  const { runAction } = useRunAction();
  setters.setTheme = prefs.setTheme;
  setters.setPat = prefs.setPat;
  setters.setLogFilters = repo.setLogFilters;
  setters.selectCommit = repo.selectCommit;
  setters.runAction = runAction;
  return null;
}

let root: Root | null = null;
let host: HTMLElement;

beforeEach(async () => {
  document.body.replaceChildren();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <ToastProvider>
        <AppDataProvider>
          <RepoProbe />
          <PrefsProbe />
          <RunActionProbe />
          <BusyProbe />
          <ActiveProbe />
          <RegistryProbe />
          <StatusProbe />
          <RefsProbe />
          <HistoryProbe />
          <BriefProbe />
          <Harness />
        </AppDataProvider>
      </ToastProvider>,
    );
    // Let the initial repo-list load settle before counting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  repoRenders = 0;
  prefsRenders = 0;
  actionRenders = 0;
  busyRenders = 0;
  activeRenders = 0;
  registryRenders = 0;
  statusRenders = 0;
  refsRenders = 0;
  historyRenders = 0;
  briefRenders = 0;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe('app-state context isolation', () => {
  it('switching theme does not re-render repo consumers', () => {
    act(() => setters.setTheme!('light'));
    expect(repoRenders).toBe(0);
    expect(prefsRenders).toBeGreaterThan(0);
  });

  it('applying log filters does not re-render preference consumers', () => {
    act(() => setters.setLogFilters!({ author: 'alice' }));
    expect(prefsRenders).toBe(0);
    expect(repoRenders).toBeGreaterThan(0);
  });

  it('flipping busy does not re-render runAction consumers', async () => {
    let resolveGate!: () => void;
    const gate = new Promise<void>((resolve) => { resolveGate = resolve; });
    // runAction sets busy synchronously before its first await.
    act(() => {
      void setters.runAction!(gate);
    });
    expect(actionRenders).toBe(0);
    expect(busyRenders).toBeGreaterThan(0);
    await act(async () => {
      resolveGate();
      await Promise.resolve();
    });
  });

  it('changing PAT does not re-render repo consumers', () => {
    act(() => setters.setPat!('tok'));
    expect(repoRenders).toBe(0);
    expect(prefsRenders).toBeGreaterThan(0);
  });

  it('selecting a commit only re-renders history consumers', () => {
    act(() => setters.selectCommit!('abc1234'));
    expect(historyRenders).toBeGreaterThan(0);
    expect(activeRenders).toBe(0);
    expect(registryRenders).toBe(0);
    expect(statusRenders).toBe(0);
    expect(refsRenders).toBe(0);
    expect(briefRenders).toBe(0);
    expect(prefsRenders).toBe(0);
    expect(busyRenders).toBe(0);
  });

  it('applying log filters does not re-render path or registry consumers', () => {
    act(() => setters.setLogFilters!({ author: 'alice' }));
    expect(historyRenders).toBeGreaterThan(0);
    expect(activeRenders).toBe(0);
    expect(registryRenders).toBe(0);
    expect(refsRenders).toBe(0);
    expect(prefsRenders).toBe(0);
  });
});
