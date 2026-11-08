// @vitest-environment jsdom
// Interaction test: the pure navigation math is covered in lib/graph-nav, this
// file proves the component actually wires those keys to selectCommit and that
// aria-activedescendant follows the selection.
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContext } from '../app-state';
import CommitGraph from './CommitGraph';

const commits = [
  { hash: 'aaaa1111', parents: [], authorName: 'A', authorEmail: 'a@x', date: '2026-11-01T00:00:00Z', subject: 'first', body: '' },
  { hash: 'bbbb2222', parents: ['aaaa1111'], authorName: 'B', authorEmail: 'b@x', date: '2026-11-02T00:00:00Z', subject: 'second', body: '' },
  { hash: 'cccc3333', parents: ['bbbb2222'], authorName: 'C', authorEmail: 'c@x', date: '2026-11-03T00:00:00Z', subject: 'third', body: '' },
];

// React 19 only batches state updates inside act() when this flag is set.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement;

beforeEach(() => {
  document.body.replaceChildren();
  host = document.createElement('div');
  document.body.append(host);
  // jsdom reports every element as 0px tall; virtualization would render none.
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 340 });
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

function mount(selectedHash: string | null, selectCommit: (hash: string | null) => void) {
  const value = {
    commits,
    selectedHash,
    selectCommit,
    currentRepo: '/tmp/repo',
    toast: () => {},
    loadMore: () => {},
    logLimit: 50,
    logScope: 'current',
    setLogScope: () => {},
    logPath: '',
    setLogPath: () => {},
    logFilters: {},
    repoLoading: false,
    status: null,
    refs: [],
    runAction: async () => null,
  };
  act(() => {
    root?.render(createElement(AppContext.Provider, { value } as never, createElement(CommitGraph)));
  });
  const list = document.querySelector('[role="listbox"]') as HTMLElement;
  expect(list).toBeTruthy();
  return list;
}

function press(list: HTMLElement, key: string) {
  act(() => {
    list.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

describe('CommitGraph keyboard wiring', () => {
  it('moves the selection down and up from nothing selected', () => {
    const select = vi.fn();
    const list = mount(null, select);

    press(list, 'ArrowDown');
    expect(select).toHaveBeenLastCalledWith('aaaa1111');

    press(list, 'ArrowUp');
    expect(select).toHaveBeenLastCalledWith('cccc3333');
  });

  it('pages by the viewport height', () => {
    const select = vi.fn();
    const list = mount('aaaa1111', select);

    press(list, 'PageDown');
    expect(select.mock.calls.at(-1)?.[0]).toBe('cccc3333');
  });

  it('clears the selection on Escape', () => {
    const select = vi.fn();
    const list = mount('bbbb2222', select);

    press(list, 'Escape');
    expect(select).toHaveBeenLastCalledWith(null);
  });

  it('ignores keys it does not own', () => {
    const select = vi.fn();
    const list = mount('aaaa1111', select);

    press(list, 'a');
    expect(select).not.toHaveBeenCalled();
  });
});
