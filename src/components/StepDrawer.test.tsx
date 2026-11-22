// @vitest-environment jsdom
// Open-PR surfaces the live board cannot show (every managed stage is merged):
// the merge split-button menu, the open-stage gate chips, the gate disclosure's
// degraded/live branches and the resolve callback wiring on drawer operations.
import { createElement, type ContextType } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreferencesContext } from '../app-state/preferences-provider';
import { enqueueAutomation, rerunFailedActions, type InboxPayload } from '../api/flows';
import { githubProxy } from '../api';
import type { Workflow } from '../lib/automation/workflow';
import type { WorkflowStageStateRow } from '../lib/automation/flows-board';
import { t, tp } from '../i18n';
import StepDrawer from './StepDrawer';
import { ConfirmProvider, ToastProvider } from './ui';

vi.mock('../api/flows', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/flows')>()),
  enqueueAutomation: vi.fn(),
  rerunFailedActions: vi.fn(),
}));
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  githubProxy: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type PreferencesData = NonNullable<ContextType<typeof PreferencesContext>>;

const flow: Workflow = {
  id: 'wf-1',
  name: 'demo',
  repository: 'owner/repo',
  stages: [{ source: 'dev', target: 'main', stageId: 's-1' }],
};

const openState: WorkflowStageStateRow = {
  workflowId: 'wf-1',
  stageIndex: 0,
  stageId: 's-1',
  source: 'dev',
  target: 'main',
  pullNumber: 7,
  pullState: 'open',
  headSha: 'abc123',
  checksState: 'success',
  checksPassed: 2,
  checksTotal: 2,
  approvals: 0,
  requiredApprovals: 1,
  mergeable: false,
  mergeableState: 'dirty',
  updatedAt: '2026-11-19T00:00:00Z',
};

function inboxWith(state: WorkflowStageStateRow, extra: Partial<InboxPayload> = {}): InboxPayload {
  return {
    items: [],
    states: [state],
    events: [],
    deployments: [],
    deploymentRuns: [],
    configurationWarnings: [],
    syncHealth: null,
    runs: [],
    timeline: [],
    recoveryStatuses: [],
    automation: [],
    ...extra,
  };
}

let root: Root | null = null;
let host: HTMLElement;
let pat = '';

function renderDrawer(
  state: WorkflowStageStateRow = openState,
  extra: Partial<InboxPayload> = {},
  props: { source?: string; flow?: Workflow } = {},
) {
  const onClose = vi.fn();
  const onMutated = vi.fn();
  const onResolved = vi.fn();
  act(() => {
    root?.render(createElement(
      PreferencesContext.Provider,
      { value: { pat, hasServerPat: false } as PreferencesData },
      createElement(ToastProvider, null, createElement(ConfirmProvider, null, createElement(StepDrawer, {
        flow: props.flow ?? flow, stageIndex: 0, source: props.source, inbox: inboxWith(state, extra), onClose, onMutated, onResolved,
      }))),
    ));
  });
  return { onClose, onMutated, onResolved };
}

const pressEscape = () => act(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
});
const menu = () => document.querySelector('[role="menu"]');
const click = (selector: string) => act(() => {
  (document.querySelector(selector) as HTMLButtonElement).click();
});

beforeEach(() => {
  pat = '';
  document.body.replaceChildren();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(enqueueAutomation).mockResolvedValue({} as never);
  vi.mocked(rerunFailedActions).mockResolvedValue({} as never);
  vi.mocked(githubProxy).mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe('StepDrawer merge method menu', () => {
  it('opens from the split-button arrow with merge commit active and squash/rebase disabled', () => {
    renderDrawer();
    expect(document.querySelector('.merge-main')?.textContent).toBe(t('merge PR'));
    expect(menu()).toBeNull();
    click('.merge-arrow');
    const options = [...document.querySelectorAll('[role="menuitem"]')];
    expect(options).toHaveLength(3);
    expect(options[0].className).toContain('active');
    expect((options[0] as HTMLButtonElement).disabled).toBe(false);
    expect(options[0].textContent).toContain(t('Merge commit (merge)'));
    for (const option of options.slice(1)) {
      expect((option as HTMLButtonElement).disabled).toBe(true);
      expect(option.getAttribute('aria-label')).toBe(t('Requires the GitHub page'));
    }
    expect(options[1].textContent).toContain(t('Squash merge (squash)'));
    expect(options[2].textContent).toContain(t('Rebase merge (rebase)'));
  });

  it('Escape closes the menu first and the drawer only on the second press', () => {
    const { onClose } = renderDrawer();
    click('.merge-arrow');
    expect(menu()).not.toBeNull();
    pressEscape();
    expect(menu()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('an outside mousedown closes the menu but keeps the drawer', () => {
    const { onClose } = renderDrawer();
    click('.merge-arrow');
    act(() => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(menu()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('the merge commit option enqueues merge-pr and marks the step resolved', async () => {
    const { onMutated, onResolved } = renderDrawer();
    click('.merge-arrow');
    await act(async () => {
      (document.querySelectorAll('[role="menuitem"]')[0] as HTMLButtonElement).click();
    });
    expect(enqueueAutomation).toHaveBeenCalledWith(expect.objectContaining({
      workflowId: 'wf-1', stageIndex: 0, source: 'dev', kind: 'merge-pr',
    }));
    expect(onResolved).toHaveBeenCalledWith(0, 'dev');
    expect(onMutated).toHaveBeenCalledTimes(1);
    expect(menu()).toBeNull();
  });
});

describe('StepDrawer gate chips', () => {
  it('open stages show approval and mergeability chips; merged stages keep only the checks chip', () => {
    renderDrawer();
    expect(host.textContent).toContain(tp('approvals {approvals}/{required}', { approvals: 0, required: 1 }));
    expect(host.textContent).toContain(t('merge conflict'));
    renderDrawer({ ...openState, pullState: 'merged', mergedAt: '2026-11-19T01:00:00Z' });
    expect(host.textContent).not.toContain(tp('approvals {approvals}/{required}', { approvals: 0, required: 1 }));
    expect(host.textContent).not.toContain(t('merge conflict'));
    expect(document.querySelector('.merge-control')).toBeNull();
    expect(document.querySelector('.drawer-gate')?.textContent).toContain(t('checks passed'));
  });

  it('the checks chip stays plain without a PAT and expands per-check once the proxy read succeeds', async () => {
    renderDrawer();
    const chip = document.querySelector('.drawer-gate') as HTMLElement;
    expect(chip.tagName).toBe('SPAN');
    expect(document.querySelector('details.gate-disclosure')).toBeNull();

    pat = 'test-pat';
    vi.mocked(githubProxy).mockImplementation(async (_pat, path) => (path.includes('/check-runs')
      ? {
        status: 200,
        data: {
          check_runs: [
            { name: 'build', app: { slug: 'github-actions' }, status: 'completed', conclusion: 'success', html_url: 'https://example.test/run/1' },
            { name: 'pages deploy', app: { slug: 'cloudflare-pages' }, status: 'completed', conclusion: 'success', output: { summary: 'Preview URL: https://preview.example.test' } },
          ],
        },
      }
      : { status: 200, data: { statuses: [{ context: 'ci/legacy', state: 'failure', target_url: null }] } }) as never);
    renderDrawer();
    await act(async () => {});
    const disclosure = document.querySelector('details.gate-disclosure');
    expect(disclosure).not.toBeNull();
    expect(disclosure?.querySelectorAll('.check-source')).toHaveLength(3);
    expect(disclosure?.textContent).toContain(t('passed'));
    expect(disclosure?.textContent).toContain(t('failed'));
    // Cloudflare summaries retarget to the stage branch: main means Production.
    expect(disclosure?.textContent).toContain('Production URL: https://preview.example.test');
    expect(disclosure?.querySelector('a.check-detail.success')?.getAttribute('href')).toBe('https://example.test/run/1');
  });
});

describe('StepDrawer resolve wiring', () => {
  it('a successful rerun marks the step resolved and refreshes the projection', async () => {
    const { onMutated, onResolved } = renderDrawer();
    await act(async () => {
      ([...document.querySelectorAll('.drawer-btn')].find((b) => b.textContent === t('rerun Actions')) as HTMLButtonElement).click();
    });
    expect(rerunFailedActions).toHaveBeenCalledWith(expect.objectContaining({ workflowId: 'wf-1', stageIndex: 0, source: 'dev' }));
    expect(onResolved).toHaveBeenCalledWith(0, 'dev');
    expect(onMutated).toHaveBeenCalledTimes(1);
  });

  it('a failed rerun surfaces the error and never marks the step resolved', async () => {
    vi.mocked(rerunFailedActions).mockRejectedValue(new Error('engine unavailable'));
    const { onMutated, onResolved } = renderDrawer();
    await act(async () => {
      ([...document.querySelectorAll('.drawer-btn')].find((b) => b.textContent === t('rerun Actions')) as HTMLButtonElement).click();
    });
    expect(onResolved).not.toHaveBeenCalled();
    expect(onMutated).not.toHaveBeenCalled();
    expect(document.querySelector('.drawer-error')?.textContent).toContain('engine unavailable');
  });
});

describe('StepDrawer step timeline and sync', () => {
  it('renders the upstream step timeline filtered to this route', () => {
    renderDrawer(openState, {
      timeline: [
        { workflowId: 'wf-1', stageIndex: 0, stageId: 's-1', source: 'dev', kind: 'pull-merged', message: 'Pull request merged', occurredAt: '2026-11-19T01:00:00Z' },
        { workflowId: 'wf-1', stageIndex: 0, stageId: 's-1', source: 'other', kind: 'checks-failure', message: 'Wrong route', occurredAt: '2026-11-19T02:00:00Z' },
        { workflowId: 'wf-2', stageIndex: 0, stageId: 's-1', source: 'dev', kind: 'run-started', message: 'Wrong workflow', occurredAt: '2026-11-19T03:00:00Z' },
      ],
    });
    const section = document.querySelector('.drawer-timeline');
    expect(section).not.toBeNull();
    expect(section?.textContent).toContain(t('Step timeline'));
    expect(section?.textContent).toContain('Pull request merged');
    expect(section?.textContent).not.toContain('Wrong route');
    expect(section?.textContent).not.toContain('Wrong workflow');
    expect(section?.querySelector('.timeline-icon')?.textContent).toBe('✅');
  });

  it('Sync again waits for the projection reload and reports completion', async () => {
    const { onMutated } = renderDrawer();
    onMutated.mockResolvedValue(undefined);
    await act(async () => {
      ([...document.querySelectorAll('.drawer-btn')].find((b) => b.textContent === t('Sync again')) as HTMLButtonElement).click();
    });
    expect(onMutated).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain(t('Step synced'));
    expect([...document.querySelectorAll('.drawer-btn')].find((b) => b.textContent === t('Sync again'))).toBeTruthy();
  });

  it('a concrete dynamic route selects its own state and action source', async () => {
    const dynamicFlow: Workflow = {
      ...flow,
      stages: [{ source: 'feature/*', target: 'main', stageId: 's-1' }],
    };
    const routeState: WorkflowStageStateRow = { ...openState, source: 'feature/b', pullNumber: 9 };
    renderDrawer(routeState, {
      states: [
        { ...openState, source: 'feature/a', pullNumber: 8 },
        routeState,
      ],
    }, { source: 'feature/b', flow: dynamicFlow });
    expect(document.querySelector('.step-drawer-head h2')?.textContent).toContain('feature/b');
    await act(async () => {
      ([...document.querySelectorAll('.drawer-btn')].find((b) => b.textContent === t('merge PR')) as HTMLButtonElement).click();
    });
    expect(enqueueAutomation).toHaveBeenCalledWith(expect.objectContaining({ source: 'feature/b', kind: 'merge-pr' }));
  });
});
