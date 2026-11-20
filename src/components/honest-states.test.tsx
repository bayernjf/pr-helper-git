// @vitest-environment jsdom
// Honesty fixes (2026-11-21 audit): the registry load must distinguish
// "loading" from "empty" (reposLoaded), and an open PR card must not claim
// "No review" while the lazy review summary is unknown.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { RepoDataProvider } from '../app-state/repo-provider';
import { PreferencesProvider } from '../app-state/preferences-provider';
import { ToastProvider } from './ui';
import { useRepoData } from '../app-state/hooks';
import { ReviewPill } from './PrBoard';

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

class MockEventSource {
  close() {}
  addEventListener() {}
}
(globalThis as unknown as { EventSource?: unknown }).EventSource =
  MockEventSource as unknown as typeof EventSource;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
function mount(ui: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(ui));
  return container;
}

afterEach(() => {
  root?.unmount();
  root = null;
  vi.mocked(api.getRepos).mockClear();
  localStorage.clear();
});

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <PreferencesProvider>
        <RepoDataProvider>{children}</RepoDataProvider>
      </PreferencesProvider>
    </ToastProvider>
  );
}

describe('registry loading honesty (reposLoaded)', () => {
  it('exposes reposLoaded=false while the first registry load is in flight', () => {
    vi.mocked(api.getRepos).mockImplementation(() => new Promise(() => { /* pending */ }));
    let snapshot: { repos: number; reposLoaded: boolean } | null = null;
    function Probe() {
      const { repos, reposLoaded } = useRepoData();
      snapshot = { repos: repos.length, reposLoaded };
      return null;
    }
    mount(<Providers><Probe /></Providers>);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.reposLoaded).toBe(false);
    // The view contract: a pending load must NOT read as "no repositories".
    expect(snapshot!.repos).toBe(0);
  });

  it('flips reposLoaded=true once the registry resolves, even when empty', async () => {
    vi.mocked(api.getRepos).mockImplementation(() => Promise.resolve({ repos: [] }));
    let loaded: boolean | null = null;
    function Probe() {
      loaded = useRepoData().reposLoaded;
      return null;
    }
    mount(<Providers><Probe /></Providers>);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(loaded).toBe(true);
  });
});

describe('ReviewPill honesty', () => {
  it('shows an unknown marker, not "No review", when the summary has not loaded', () => {
    const c = mount(<ReviewPill state="UNKNOWN" />);
    expect(c.textContent).not.toContain('No review');
    expect(c.textContent).toContain('review ?');
  });

  it('keeps the real summaries and the honest NONE state', () => {
    const c = mount(
      <div>
        <ReviewPill state="APPROVED" />
        <ReviewPill state="NONE" />
      </div>,
    );
    expect(c.textContent).toContain('Approved');
    expect(c.textContent).toContain('No review');
  });
});
