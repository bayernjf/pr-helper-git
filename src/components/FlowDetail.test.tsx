// @vitest-environment jsdom
// Details that only the upstream detail page exposed: an editable auto-create
// threshold, the pinned-generation-rule drift notice with Sync, the per-stage
// automation status block and clickable dynamic-route rows.
import { createElement, type ContextType } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreferencesContext } from '../app-state/preferences-provider';
import { fetchAiCredential, fetchGenerationRules, saveWorkflowToServer, type InboxPayload } from '../api/flows';
import type { BoardState, WorkflowStageStateRow } from '../lib/automation/flows-board';
import type { Workflow } from '../lib/automation/workflow';
import { t } from '../i18n';
import FlowDetail from './FlowDetail';
import { ConfirmProvider, ToastProvider } from './ui';

vi.mock('../api/flows', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/flows')>()),
  fetchAiCredential: vi.fn(),
  fetchGenerationRules: vi.fn(),
  saveWorkflowToServer: vi.fn(),
  enqueueAutomation: vi.fn(),
  rerunFailedActions: vi.fn(),
  deleteFlowFromServer: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type PreferencesData = NonNullable<ContextType<typeof PreferencesContext>>;

const pinned = { name: 'Default', content: 'old rule', capturedAt: '2026-11-20T00:00:00Z' };
const flow: Workflow = {
  id: 'wf-1',
  name: 'demo',
  repository: 'owner/repo',
  stages: [{
    source: 'dev',
    target: 'main',
    stageId: 's-1',
    automation: {
      autoCreatePullRequest: true,
      executionMode: 'server',
      triggerMinCommits: 1,
      generationRule: pinned,
    },
  }],
};

const stateRow: WorkflowStageStateRow = {
  workflowId: 'wf-1',
  stageIndex: 0,
  stageId: 's-1',
  source: 'dev',
  target: 'main',
  aheadBy: 4,
  updatedAt: '2026-11-21T00:00:00Z',
};

const boardState = (workflow: Workflow = flow, states: WorkflowStageStateRow[] = [stateRow]): BoardState => ({
  workflows: [workflow],
  states,
  actionQueue: [],
  automationActions: [{
    id: 1,
    workflowId: 'wf-1',
    stageId: 's-1',
    stageIndex: 0,
    source: 'dev',
    target: 'main',
    kind: 'create-pr',
    state: 'failed',
    attempts: 2,
    failureReason: 'AI key rejected',
    updatedAt: '2026-11-21T01:00:00Z',
  }],
  recoveryStatuses: [],
  syncHealth: null,
  configurationWarnings: [],
  runs: [],
  timeline: [],
});

let root: Root | null = null;
let host: HTMLElement;

function inboxFor(state: BoardState): InboxPayload {
  return {
    items: [],
    states: [...state.states],
    events: [],
    deployments: [],
    deploymentRuns: [],
    configurationWarnings: [],
    syncHealth: null,
    runs: [],
    timeline: [],
    recoveryStatuses: [],
    automation: [...state.automationActions],
  };
}

function renderDetail(input: { workflow?: Workflow; state?: BoardState; onOpenDrawer?: (stageIndex: number, source?: string) => void; inbox?: InboxPayload } = {}) {
  const state = input.state ?? boardState();
  const onSaved = vi.fn();
  const onMutated = vi.fn();
  act(() => {
    root?.render(createElement(
      PreferencesContext.Provider,
      { value: { pat: '', hasServerPat: false } as PreferencesData },
      createElement(ToastProvider, null, createElement(ConfirmProvider, null, createElement(FlowDetail, {
        flowId: 'wf-1',
        state,
        events: [],
        inbox: input.inbox ?? inboxFor(state),
        onClose: vi.fn(),
        onOpenDrawer: input.onOpenDrawer,
        onSaved,
        onMutated,
      }))),
    ));
  });
  return { onSaved, onMutated };
}

beforeEach(() => {
  document.body.replaceChildren();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(fetchAiCredential).mockResolvedValue({
    credential: { configured: true, autoGeneratePrMessage: true, autoConfirmPrCreation: true },
  });
  vi.mocked(fetchGenerationRules).mockResolvedValue({
    rules: [{ name: 'Default', label: 'Default', content: 'old rule', contentHash: 'h1', createdAt: '2026-11-20T00:00:00Z' }],
  });
  vi.mocked(saveWorkflowToServer).mockImplementation(async (workflow) => workflow as never);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe('FlowDetail automation block', () => {
  it('the auto-create threshold is editable in place and saves the clamped integer', async () => {
    const { onSaved, onMutated } = renderDetail();
    await act(async () => {});
    const input = document.querySelector('.detail-threshold input') as HTMLInputElement;
    expect(input.value).toBe('1');
    expect(input.disabled).toBe(false);
    input.value = '7';
    await act(async () => {
      input.focus();
      input.blur();
    });
    expect(saveWorkflowToServer).toHaveBeenCalledTimes(1);
    const saved = vi.mocked(saveWorkflowToServer).mock.calls[0][0];
    expect(saved.stages[0].automation?.triggerMinCommits).toBe(7);
    expect(onSaved).toHaveBeenCalledWith(saved);
    expect(onMutated).toHaveBeenCalledTimes(1);
  });

  it('shows the latest automation action state and failure reason', async () => {
    renderDetail();
    await act(async () => {});
    const status = document.querySelector('.detail-automation-status');
    expect(status?.textContent).toContain(t('auto-create PR'));
    expect(status?.textContent).toContain(t('failed'));
    expect(status?.textContent).toContain('AI key rejected');
  });

  it('a drifted same-named rule shows the outdated notice and Sync re-pins it', async () => {
    vi.mocked(fetchGenerationRules).mockResolvedValue({
      rules: [{ name: 'Default', label: 'Default', content: 'new rule', contentHash: 'h2', createdAt: '2026-11-21T00:00:00Z' }],
    });
    renderDetail();
    await act(async () => {});
    const notice = document.querySelector('.detail-rule-outdated');
    expect(notice?.textContent).toContain('Default');
    await act(async () => {
      ([...notice!.querySelectorAll('button')][0] as HTMLButtonElement).click();
    });
    const saved = vi.mocked(saveWorkflowToServer).mock.calls.at(-1)![0];
    expect(saved.stages[0].automation?.generationRule?.name).toBe('Default');
    expect(saved.stages[0].automation?.generationRule?.content).toBe('new rule');
  });
});

describe('FlowDetail dynamic routes', () => {
  it('a clicked route opens the drawer for that concrete source branch', async () => {
    const dynamicFlow: Workflow = {
      ...flow,
      stages: [{ source: 'feature/*', target: 'main', stageId: 's-1' }],
    };
    const routes: WorkflowStageStateRow[] = [
      { ...stateRow, source: 'feature/a', pullNumber: 10, pullState: 'open' },
      { ...stateRow, source: 'feature/b', pullNumber: 11, pullState: 'open' },
    ];
    const onOpenDrawer = vi.fn();
    renderDetail({ workflow: dynamicFlow, state: boardState(dynamicFlow, routes), onOpenDrawer });
    await act(async () => {});
    const rows = [...document.querySelectorAll('.detail-route-row')] as HTMLButtonElement[];
    expect(rows).toHaveLength(2);
    await act(async () => rows[1].click());
    expect(onOpenDrawer).toHaveBeenCalledWith(0, 'feature/b');
  });
});
