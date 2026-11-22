// @vitest-environment jsdom
// The upstream Flows create-PR dialog restored local drafts, rejected a
// second PR for the same route, and posted the editable title/body to GitHub.
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { githubProxy } from '../api';
import FlowCreatePrModal from './FlowCreatePrModal';
import { ToastProvider } from './ui';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  githubProxy: vi.fn(),
}));
vi.mock('../app-state/hooks', () => ({
  usePreferences: () => ({ pat: 'pat', hasServerPat: false }),
  useRepoData: () => ({ remote: null, activeRepo: null }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement;
const onCreated = vi.fn();

function renderModal() {
  act(() => {
    root?.render(createElement(ToastProvider, null, createElement(FlowCreatePrModal, {
      repository: 'owner/repo', source: 'dev', target: 'main', onClose: vi.fn(), onCreated,
    })));
  });
}

async function submit() {
  await act(async () => {
    document.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  localStorage.clear();
  onCreated.mockReset();
  document.body.replaceChildren();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(githubProxy).mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe('FlowCreatePrModal', () => {
  it('checks for an open PR, then posts the editable title and body', async () => {
    vi.mocked(githubProxy)
      .mockResolvedValueOnce({ status: 200, data: [] })
      .mockResolvedValueOnce({ status: 201, data: { number: 9 } });
    renderModal();
    const title = document.querySelector<HTMLInputElement>('#flow-pr-title')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(title, 'feat: flow dialog');
      title.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await submit();
    expect(vi.mocked(githubProxy).mock.calls[0][1]).toContain('/pulls?state=open');
    expect(vi.mocked(githubProxy).mock.calls[1]).toEqual([
      'pat', '/repos/owner/repo/pulls', 'POST',
      { title: 'feat: flow dialog', head: 'dev', base: 'main', body: '', draft: false },
    ]);
    expect(onCreated).toHaveBeenCalled();
  });

  it('stops before POST when the route already has an open PR', async () => {
    vi.mocked(githubProxy).mockResolvedValueOnce({ status: 200, data: [{ number: 9 }] });
    renderModal();
    await submit();
    expect(vi.mocked(githubProxy)).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.drawer-error')?.textContent).toContain('#9');
    expect(onCreated).not.toHaveBeenCalled();
  });
});
