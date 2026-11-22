// @vitest-environment jsdom
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreferencesContext } from '../app-state/preferences-provider';
import SettingsModal from './SettingsModal';
import { ToastProvider } from './ui';
import { getAiConfig, getMe, getStorage } from '../api';

vi.mock('../api', () => ({
  getMe: vi.fn(),
  getAiConfig: vi.fn(() => Promise.resolve({
    baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', hasKey: true, configured: true,
  })),
  getStorage: vi.fn(() => Promise.resolve({ dataDir: '/tmp/git2', files: [] })),
  saveAiConfig: vi.fn(),
  testAi: vi.fn(),
  rotateAudit: vi.fn(),
  pruneRepos: vi.fn(),
  getGithubAuthStatus: vi.fn(() => Promise.resolve({
    configured: true,
    appSlug: 'pr-helper-by-test',
    installUrl: 'https://github.com/apps/pr-helper-by-test/installations/new',
    missingEnv: [],
    connected: false,
    login: null,
    avatarUrl: null,
    githubUserId: null,
    connectedAt: null,
    expiresAt: null,
    expired: false,
  })),
  getGithubInstallations: vi.fn(() => Promise.resolve({ installations: [], installUrl: null })),
  logoutGithub: vi.fn(),
  pollGithubDeviceFlow: vi.fn(),
  startGithubDeviceFlow: vi.fn(),
  getA2aStatus: vi.fn(() => Promise.resolve({
    configured: true,
    source: 'config',
    hint: 'abcd',
    createdAt: '2026-11-15T00:00:00.000Z',
    allowAnonymous: false,
    cardUrl: 'http://127.0.0.1:4789/api/a2a/agent-card',
    skills: ['create-pr', 'merge-pr'],
    tokenEnv: 'PR_HELPER_GIT_A2A_TOKEN',
    legacyTokenEnv: 'ZEUS_A2A_TOKEN',
  })),
  generateA2aToken: vi.fn(),
  revokeA2aToken: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement;

beforeEach(() => {
  localStorage.clear();
  document.body.replaceChildren();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.clearAllMocks();
});

function context() {
  return {
    pat: '',
    setPat: vi.fn(),
    hasServerPat: false,
    setServerPat: vi.fn(),
    clearServerPat: vi.fn(),
    theme: 'dark',
    accent: 'violet',
    setTheme: vi.fn(),
    setAccent: vi.fn(),
  };
}

async function mount(role: 'admin' | 'member', options?: { onClose?: () => void }) {
  vi.mocked(getMe).mockResolvedValue({ name: 'owner', role, instance: role === 'admin' } as never);
  act(() => root!.render(
    createElement(
      PreferencesContext.Provider,
      { value: context() as never },
      createElement(ToastProvider, null, createElement(SettingsModal, {
        onClose: options?.onClose ?? (() => {}),
      })),
    ),
  ));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function headings(): string[] {
  return [...document.querySelectorAll('h3.settings-section')].map((el) => el.textContent || '');
}

describe('SettingsModal role gating', () => {
  it('shows server PAT, data and AI sections to the owner', async () => {
    await mount('admin');
    expect(headings()).toContain('Server-side PAT');
    expect(headings()).toContain('Server data');
    expect(headings()).toContain('AI generation');
    expect(headings()).toContain('GitHub account');
    expect(headings()).toContain('A2A / Agent Card');
    expect(document.body.textContent).toContain('Connect GitHub');
    expect(vi.mocked(getAiConfig)).toHaveBeenCalled();
    expect(vi.mocked(getStorage)).toHaveBeenCalled();
  });

  it('hides owner-only sections from a member and keeps the browser PAT', async () => {
    await mount('member');
    expect(headings()).not.toContain('Server-side PAT');
    expect(headings()).not.toContain('Server data');
    expect(headings()).not.toContain('AI generation');
    expect(headings()).not.toContain('GitHub account');
    expect(headings()).not.toContain('A2A / Agent Card');
    // Repository tools live in the toolbar's More menu, not in Settings.
    expect(headings()).not.toContain('Repository tools');
    expect(document.body.textContent).not.toContain('Manage remotes');
    expect(headings()).toContain('Application');
    expect(vi.mocked(getAiConfig)).not.toHaveBeenCalled();
    expect(vi.mocked(getStorage)).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('managed by the owner');
    expect(document.body.textContent).toContain('localStorage');
  });

  it('offers the expanded accent palette', async () => {
    await mount('admin');
    const swatches = [...document.querySelectorAll<HTMLButtonElement>('.settings-accent')];
    expect(swatches).toHaveLength(8);
    expect(swatches.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Violet', 'Rose', 'Ocean', 'Forest', 'Amber', 'Teal', 'Crimson', 'Indigo',
    ]);
  });

  it('keeps repository tools out of the settings sidebar', async () => {
    await mount('admin');
    expect(headings()).not.toContain('Repository tools');
    expect(document.body.textContent).not.toContain('Search across all repositories');
    expect(document.body.textContent).not.toContain('Compare two references');
  });
});
