// @vitest-environment jsdom
// A comparison side must accept a commit that was never loaded into the graph,
// and the working tree must be reported honestly: untracked files are not part
// of `git diff`, so they get their own section instead of vanishing.
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContext } from '../app-state';
import { getCompare } from '../api';
import { setLocale } from '../i18n';
import type { Commit, Ref } from '../types';
import CompareModal from './CompareModal';
import { RefPicker, type RefPickerOption } from './RefPicker';

vi.mock('../api', () => ({ getCompare: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement;

beforeEach(() => {
  setLocale('en');
  localStorage.clear();
  document.body.replaceChildren();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  // jsdom has no layout engine, so the active-row scroll is a no-op stub.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.clearAllMocks();
});

const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const OTHER_SHA = 'b2c3d4e5f60718293a4b5c6d7e8f9012345678a1';

function commit(hash: string, subject: string): Commit {
  return {
    hash,
    parents: [],
    authorName: 'Tester',
    authorEmail: 'tester@example.com',
    date: '2026-11-11T10:00:00+08:00',
    subject,
    body: '',
  };
}

function ref(shortName: string, hash: string): Ref {
  return {
    hash,
    type: 'branch',
    name: `refs/heads/${shortName}`,
    shortName,
    upstream: null,
    ahead: 0,
    behind: 0,
  };
}

const pickerOptions: RefPickerOption[] = [
  { value: ':worktree', label: 'Working tree', hint: 'Uncommitted changes', group: 'Working tree' },
  { value: 'main', label: 'main', hint: 'a1b2c3d', group: 'Reference' },
  { value: 'topic', label: 'topic', hint: 'b2c3d4e', group: 'Reference' },
  { value: SHA, label: 'a1b2c3d add the picker', hint: 'Tester', group: 'Commit' },
];

function input(): HTMLInputElement {
  return document.querySelector('input[role="combobox"]') as HTMLInputElement;
}

function optionTexts(): string[] {
  return [...document.querySelectorAll('[role="option"] .ref-picker-label')]
    .map((el) => el.textContent || '');
}

function type(value: string) {
  const el = input();
  act(() => {
    el.focus();
    // React tracks the value on the DOM node, so the native setter is required
    // for onChange to fire the way a real keystroke would.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function keyOn(el: HTMLInputElement, name: string) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
  });
}

function key(name: string) {
  keyOn(input(), name);
}

function mountPicker(onChange = vi.fn(), options = pickerOptions) {
  act(() => root!.render(
    createElement(RefPicker, { value: 'main', onChange, options, label: 'Base' }),
  ));
  return onChange;
}

describe('RefPicker', () => {
  it('offers a typed SHA that is not among the loaded options', () => {
    const onChange = mountPicker();
    type(OTHER_SHA);
    expect(optionTexts()[0]).toBe(OTHER_SHA);
    expect(document.body.textContent).toContain('Use this commit');

    key('Enter');
    expect(onChange).toHaveBeenCalledWith(OTHER_SHA);
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });

  it('does not invent a commit entry for a ref name or a too-short hex string', () => {
    mountPicker();
    type('top');
    expect(optionTexts()).toEqual(['topic']);
    expect(document.body.textContent).not.toContain('Use this commit');

    type('abc123');
    expect(optionTexts()).toEqual([]);
    expect(document.querySelector('.dropdown-empty')?.textContent).toBe('No match.');
  });

  it('filters by subject and by author hint, not only by ref name', () => {
    mountPicker();
    type('add the pick');
    expect(optionTexts()).toEqual(['a1b2c3d add the picker']);
    type('Tester');
    expect(optionTexts()).toEqual(['a1b2c3d add the picker']);
  });

  it('reports how many options it is not rendering', () => {
    const many: RefPickerOption[] = Array.from({ length: 95 }, (_, i) => ({
      value: `branch-${i}`, label: `branch-${i}`, group: 'Reference',
    }));
    mountPicker(vi.fn(), many);
    act(() => input().focus());
    expect(document.querySelectorAll('[role="option"]').length).toBe(80);
    expect(document.querySelector('.ref-picker-more')?.textContent)
      .toBe('15 more — keep typing to narrow.');

    type('branch-9');
    expect(document.querySelectorAll('[role="option"]').length).toBe(6);
    expect(document.querySelector('.ref-picker-more')).toBeNull();
  });

  it('closes the popup on Escape without closing the dialog above it', async () => {
    const onClose = vi.fn();
    const { useEscape } = await import('../hooks/use-escape');
    function Harness() {
      useEscape(onClose);
      return createElement(RefPicker, {
        value: 'main', onChange: vi.fn(), options: pickerOptions, label: 'Base',
      });
    }
    act(() => root!.render(createElement(Harness)));
    act(() => input().focus());
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();

    key('Escape');
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    // With the popup closed the same key must reach the dialog.
    key('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves the active row with the arrow keys and selects it with Enter', () => {
    const onChange = mountPicker();
    act(() => input().focus());
    key('ArrowDown');
    key('ArrowDown');
    expect(input().getAttribute('aria-activedescendant')).toMatch(/-opt-2$/);
    key('Enter');
    expect(onChange).toHaveBeenCalledWith('topic');
  });
});

function appContext() {
  return {
    activeRepo: '/tmp/repo',
    refs: [ref('main', SHA), ref('topic', OTHER_SHA), {
      ...ref('stash@{0}', SHA), name: 'refs/stash', type: 'stash',
    }],
    commits: [commit(SHA, 'add the picker'), commit(OTHER_SHA, 'older work')],
    status: { branch: 'main' },
  };
}

async function mountModal() {
  const onClose = vi.fn();
  act(() => root!.render(
    createElement(
      AppContext.Provider,
      { value: appContext() as never },
      createElement(CompareModal, { onClose }),
    ),
  ));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return onClose;
}

function pickers(): HTMLInputElement[] {
  return [...document.querySelectorAll('input[role="combobox"]')] as HTMLInputElement[];
}

function typeInto(el: HTMLInputElement, value: string) {
  act(() => {
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('CompareModal sides', () => {
  beforeEach(() => {
    vi.mocked(getCompare).mockResolvedValue({
      base: 'main', head: 'topic', ahead: [], behind: [], files: [], untracked: [],
    });
  });

  it('offers the working tree, refs and commits, and hides the stash', async () => {
    await mountModal();
    expect(vi.mocked(getCompare)).toHaveBeenCalledWith('/tmp/repo', 'main', 'topic');
    act(() => pickers()[1].focus());
    const labels = optionTexts();
    expect(labels[0]).toBe('Working tree');
    expect(labels).toContain('main');
    expect(labels).toContain('a1b2c3d add the picker');
    expect(labels.some((l) => l.includes('stash'))).toBe(false);
    expect(document.querySelectorAll('.ref-picker-group').length).toBe(3);
  });

  it('compares a typed commit SHA against a branch', async () => {
    await mountModal();
    // A commit that is not in the loaded graph: only the typed entry can supply it.
    const unloaded = 'c3d4e5f60718293a4b5c6d7e8f9012345678a1b2';
    const base = pickers()[0];
    typeInto(base, unloaded);
    expect(optionTexts()[0]).toBe(unloaded);
    keyOn(base, 'Enter');
    act(() => (document.querySelector('.compare-picker .btn-primary') as HTMLButtonElement).click());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(vi.mocked(getCompare)).toHaveBeenLastCalledWith('/tmp/repo', unloaded, 'topic');
  });

  it('swaps the two sides and re-runs the comparison', async () => {
    await mountModal();
    act(() => (document.querySelector('.compare-swap') as HTMLButtonElement).click());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(vi.mocked(getCompare)).toHaveBeenLastCalledWith('/tmp/repo', 'topic', 'main');
    expect(pickers()[0].value).toBe('topic');
    expect(pickers()[1].value).toBe('main');
  });

  it('disables Compare when both sides are the same', async () => {
    await mountModal();
    const head = pickers()[1];
    typeInto(head, 'main');
    keyOn(head, 'Enter');
    expect((document.querySelector('.compare-picker .btn-primary') as HTMLButtonElement).disabled)
      .toBe(true);
    expect((document.querySelector('.compare-swap') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('CompareModal working-tree result', () => {
  beforeEach(() => {
    vi.mocked(getCompare).mockResolvedValue({
      base: 'main',
      head: ':worktree',
      ahead: [],
      behind: [],
      files: [
        { status: 'M', path: 'tracked.txt', additions: 1, deletions: 1 },
        { status: 'R100', path: 'new.txt', renamedFrom: 'old.txt', additions: 0, deletions: 0 },
      ],
      untracked: ['junk.txt', 'nested/also-junk.txt'],
    });
  });

  async function mountWorktree() {
    await mountModal();
    const head = pickers()[1];
    typeInto(head, 'Working tree');
    keyOn(head, 'Enter');
    act(() => (document.querySelector('.compare-picker .btn-primary') as HTMLButtonElement).click());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }

  it('counts untracked files and explains why the commit lists are empty', async () => {
    await mountWorktree();
    expect(vi.mocked(getCompare)).toHaveBeenLastCalledWith('/tmp/repo', 'main', ':worktree');
    const summary = document.querySelector('.compare-summary')!.textContent || '';
    expect(summary).toContain('2 untracked files');
    expect(document.querySelector('.compare-note')?.textContent)
      .toContain('the commit lists compare HEAD');

    act(() => {
      const commitsTab = [...document.querySelectorAll('.compare-tabs button')]
        .find((b) => b.textContent === 'Commits') as HTMLButtonElement;
      commitsTab.click();
    });
    expect(document.body.textContent).toContain('In “Working tree” but not “main”');
  });

  it('lands on Files for a working-tree comparison, where the content is', async () => {
    await mountWorktree();
    const active = [...document.querySelectorAll('.compare-tabs button')]
      .find((b) => b.className === 'active');
    expect(active?.textContent).toBe('Files');
    expect(document.querySelector('.compare-result')?.textContent).toContain('tracked.txt');
  });

  it('keeps the Commits tab for a comparison between two refs', async () => {
    vi.mocked(getCompare).mockResolvedValue({
      base: 'main', head: 'topic', ahead: [], behind: [], files: [], untracked: [],
    });
    await mountModal();
    const active = [...document.querySelectorAll('.compare-tabs button')]
      .find((b) => b.className === 'active');
    expect(active?.textContent).toBe('Commits');
  });

  it('lists untracked files separately from the diff and shows rename sources', async () => {
    await mountWorktree();
    const rows = [...document.querySelectorAll('.compare-result .compare-subject')]
      .map((el) => el.textContent || '');
    expect(rows).toEqual(['tracked.txt', 'old.txt → new.txt', 'junk.txt', 'nested/also-junk.txt']);
    expect(document.body.textContent)
      .toContain('Untracked files (2) — not part of the diff');
  });

  it('shows no untracked summary when neither side is the working tree', async () => {
    vi.mocked(getCompare).mockResolvedValue({
      base: 'main', head: 'topic', ahead: [], behind: [], files: [], untracked: [],
    });
    await mountModal();
    expect(document.querySelector('.compare-summary')?.textContent)
      .not.toContain('untracked');
    expect(document.querySelector('.compare-note')).toBeNull();
  });
});