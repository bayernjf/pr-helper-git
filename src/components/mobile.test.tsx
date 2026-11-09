// @vitest-environment jsdom
// DOM test for the read-only phone layout: mount it, load a repository, open
// a commit and then a file, and assert the rendered text follows the fetched
// payloads. fetch is stubbed, so nothing leaves the process.
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MobileApp from './MobileApp';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const repo = '/tmp/mobile-repo';

function json(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
}

let root: Root | null = null;
let host: HTMLElement;

beforeEach(() => {
  localStorage.clear();
  document.body.replaceChildren();
  host = document.createElement('div');
  document.body.append(host);
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/repos')) {
      return json({ repos: [{ path: repo, name: 'demo', branch: 'main', upstream: null, ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0, lastCommit: null, error: null }] });
    }
    if (url.includes('/api/log')) {
      return json({
        commits: [
          { hash: 'aaaa1111', parents: [], authorName: 'Ann', authorEmail: 'ann@x', date: '2026-11-08T10:00:00Z', subject: 'fix the thing', body: '' },
          { hash: 'bbbb2222', parents: ['aaaa1111'], authorName: 'Bob', authorEmail: 'bob@x', date: '2026-11-07T10:00:00Z', subject: 'add the thing', body: '' },
        ],
      });
    }
    if (url.includes('/api/status')) {
      return json({ status: { branch: 'main', upstream: 'origin/main', ahead: 1, behind: 0, files: [] } });
    }
    if (url.includes('/api/commit-files')) {
      return json({ files: [{ status: 'M', path: 'src/app.ts', additions: 3, deletions: 1 }] });
    }
    if (url.includes('/api/signature')) {
      return json({ sha: 'aaaa1111', status: 'N', signer: '', key: '', verified: false });
    }
    if (url.includes('/api/commit-diff')) {
      return json({ masked: false, path: 'src/app.ts', diff: '@@ -1 +1 @@\n-old line\n+new line', truncated: false });
    }
    return Promise.resolve(new Response('{}', { status: 404 }));
  }));
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('mobile read-only view', () => {
  it('lists commits and opens a commit with its files and diff', async () => {
    await act(async () => { root!.render(createElement(MobileApp)); });
    await flush();
    expect(host.textContent).toContain('fix the thing');
    expect(host.textContent).toContain('main');
    expect(host.textContent).toContain('1'); // ahead counter

    const commitBtn = host.querySelectorAll('button.m-commit')[0] as HTMLButtonElement;
    expect(commitBtn).toBeTruthy();
    await act(async () => { commitBtn.click(); });
    await flush();
    expect(host.textContent).toContain('src/app.ts');
    expect(host.textContent).toContain('N'); // unsigned signature verdict

    const fileBtn = host.querySelectorAll('button.m-file')[0] as HTMLButtonElement;
    await act(async () => { fileBtn.click(); });
    await flush();
    expect(host.textContent).toContain('+new line');
  });
  it('lists working-tree changes and opens their diff', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/repos')) {
        return json({ repos: [{ path: repo, name: 'demo', branch: 'main', upstream: null, ahead: 0, behind: 1, staged: 1, unstaged: 2, untracked: 1, lastCommit: null, error: null }] });
      }
      if (url.includes('/api/log')) {
        return json({ commits: [{ hash: 'cccc3333', parents: [], authorName: 'Ann', authorEmail: 'ann@x', date: '2026-11-08T10:00:00Z', subject: 'wip', body: '' }] });
      }
      if (url.includes('/api/status')) {
        return json({ status: { branch: 'main', upstream: 'origin/main', ahead: 0, behind: 1, files: [
          { path: 'staged.txt', status: 'M', area: 'staged' },
          { path: 'work.txt', status: 'M', area: 'unstaged' },
          { path: 'new.txt', status: '?', area: 'untracked' },
        ] } });
      }
      if (url.includes('/api/diff')) {
        return json({ masked: false, path: 'work.txt', diff: '@@ -1 +1 @@\n-old\n+work line', truncated: false });
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    }));

    await act(async () => { root!.render(createElement(MobileApp)); });
    await flush();
    expect(host.textContent).toContain('Uncommitted changes');
    expect(host.textContent).toContain('new.txt');

    const rows = host.querySelectorAll('section.m-status button.m-file');
    expect(rows.length).toBe(3);
    await act(async () => { (rows[1] as HTMLButtonElement).click(); });
    await flush();
    expect(host.textContent).toContain('+work line');
  });
});
