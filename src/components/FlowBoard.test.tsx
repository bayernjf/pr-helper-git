// @vitest-environment jsdom
// The board has two different empty states: "no flows yet" and "no flows
// match this filter". Neither may render while the first projection read is
// still in flight, otherwise a slow load looks like an empty workspace.
import { createElement, type ContextType } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreferencesContext } from '../app-state/preferences-provider';
import { fetchFlows, fetchInbox, type InboxPayload } from '../api/flows';
import type { Workflow } from '../lib/automation/workflow';
import { t } from '../i18n';
import FlowBoard from './FlowBoard';
import { ConfirmProvider, ToastProvider } from './ui';

vi.mock('../api/flows', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/flows')>()),
  fetchFlows: vi.fn(),
  fetchInbox: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type PreferencesData = NonNullable<ContextType<typeof PreferencesContext>>;

const emptyInbox: InboxPayload = {
  items: [],
  states: [],
  events: [],
  deployments: [],
  deploymentRuns: [],
  configurationWarnings: [],
  syncHealth: null,
  runs: [],
  timeline: [],
  recoveryStatuses: [],
  automation: [],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let root: Root | null = null;
let host: HTMLElement;

function renderBoard() {
  act(() => {
    root?.render(createElement(
      PreferencesContext.Provider,
      { value: { pat: '', hasServerPat: false } as PreferencesData },
      createElement(ToastProvider, null, createElement(ConfirmProvider, null, createElement(FlowBoard))),
    ));
  });
}

beforeEach(() => {
  document.body.replaceChildren();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe('Flow board initial load', () => {
  it('does not render the empty state while the first projection read is pending', async () => {
    const inbox = deferred<InboxPayload>();
    const flows = deferred<{ workflows: Workflow[] }>();
    vi.mocked(fetchInbox).mockReturnValue(inbox.promise);
    vi.mocked(fetchFlows).mockReturnValue(flows.promise);

    renderBoard();
    await act(async () => {});

    expect(document.body.textContent).toContain(t('Refreshing…'));
    expect(document.querySelector('.board-empty')).toBeNull();

    await act(async () => {
      inbox.resolve(emptyInbox);
      flows.resolve({ workflows: [] });
      await Promise.resolve();
    });
    await act(async () => {});

    expect(document.querySelector('.board-empty h3')?.textContent).toBe(t('No flows yet — create one from a repository'));
  });
});
