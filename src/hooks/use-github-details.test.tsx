// @vitest-environment jsdom
// Server-stored PAT mode intentionally sends an empty x-github-pat header:
// the server injects its admin token. These probes guard the two hooks that
// previously short-circuited on an empty browser PAT and silently degraded.
import { createElement, type ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { githubProxy } from '../api';
import { useBranches } from './use-branches';
import { useCheckDetails } from './use-check-details';

vi.mock('../api', () => ({ githubProxy: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement;

function BranchProbe({ pat, hasServerPat }: { pat: string; hasServerPat: boolean }) {
  const branches = useBranches(pat, hasServerPat, 'owner/repo');
  return createElement('div', { 'data-testid': 'branches' }, branches?.join(',') ?? 'null');
}

function CheckProbe({ pat, hasServerPat }: { pat: string; hasServerPat: boolean }) {
  const details = useCheckDetails(pat, hasServerPat, 'owner/repo', 'abc123');
  return createElement(
    'div',
    { 'data-testid': 'checks' },
    details?.map((detail) => `${detail.name}:${detail.state}`).join(',') ?? 'null',
  );
}

async function mount(node: ReactNode) {
  await act(async () => {
    root?.render(node);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
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

describe('server-stored PAT fallbacks', () => {
  it('loads branches with an empty browser PAT when a server PAT exists', async () => {
    vi.mocked(githubProxy).mockResolvedValue({
      status: 200,
      data: [{ name: 'dev' }, { name: 'main' }],
    } as never);

    await mount(createElement(BranchProbe, { pat: '', hasServerPat: true }));

    expect(host.textContent).toBe('dev,main');
    expect(githubProxy).toHaveBeenCalledWith('', '/repos/owner/repo/branches?per_page=100');
  });

  it('does not request branches without either PAT', async () => {
    await mount(createElement(BranchProbe, { pat: '', hasServerPat: false }));

    expect(host.textContent).toBe('null');
    expect(githubProxy).not.toHaveBeenCalled();
  });

  it('loads check details with an empty browser PAT when a server PAT exists', async () => {
    vi.mocked(githubProxy).mockImplementation(async (_pat, path) => {
      if (path.includes('/check-runs')) {
        return {
          status: 200,
          data: {
            check_runs: [{
              name: 'smoke',
              status: 'completed',
              conclusion: 'success',
              html_url: 'https://github.com/example/actions/runs/1',
            }],
          },
        } as never;
      }
      return { status: 200, data: { statuses: [] } } as never;
    });

    await mount(createElement(CheckProbe, { pat: '', hasServerPat: true }));

    expect(host.textContent).toBe('smoke:success');
    expect(githubProxy).toHaveBeenCalledWith(
      '',
      '/repos/owner/repo/commits/abc123/check-runs?per_page=100',
    );
  });
});
