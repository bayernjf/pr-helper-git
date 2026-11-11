// @vitest-environment jsdom
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContext } from '../app-state';
import SettingsModal from './SettingsModal';
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
    toast: vi.fn(),
    theme: 'dark',
    accent: 'violet',
    setTheme: vi.fn(),
    setAccent: vi.fn(),
  };
}

async function mount(role: 'admin' | 'member') {
  vi.mocked(getMe).mockResolvedValue({ name: 'owner', role, instance: role === 'admin' } as never);
  act(() => root!.render(
    createElement(
      AppContext.Provider,
      { value: context() as never },
      createElement(SettingsModal, { onClose: () => {} }),
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
    expect(vi.mocked(getAiConfig)).toHaveBeenCalled();
    expect(vi.mocked(getStorage)).toHaveBeenCalled();
  });

  it('hides owner-only sections from a member and keeps the browser PAT', async () => {
    await mount('member');
    expect(headings()).not.toContain('Server-side PAT');
    expect(headings()).not.toContain('Server data');
    expect(headings()).not.toContain('AI generation');
    expect(vi.mocked(getAiConfig)).not.toHaveBeenCalled();
    expect(vi.mocked(getStorage)).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('managed by the owner');
    expect(document.body.textContent).toContain('localStorage');
  });
});
