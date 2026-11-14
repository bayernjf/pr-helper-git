// Step drawer (Phase 3, P3-3): per-step operations — create PR / merge /
// rerun / AI takeover — over the automation actions on one stage route, plus
// the stage's event stream. Operations ride the write routes landed in
// server/flows.mjs and fail loudly until P2-1 provides the credentials.
import { useMemo, useState } from 'react';
import { useToast } from './ui';
import { errorMessage } from '../lib/errors';
import { stageStateText } from '../lib/automation/flows-detail';
import { matchingStageProjections, type Workflow } from '../lib/automation/workflow';
import { automationActionPresentation, type AutomationActionState } from '../lib/automation/workflow-run';
import { githubPullUrl } from '../lib/domain';
import {
  enqueueAutomation,
  executeAutomationAction,
  regenerateAutomationMessage,
  rerunFailedActions,
  takeoverAutomationAction,
  type InboxPayload,
} from '../api/flows';
import type { ActionQueueItem, AutomationActionRow, WorkflowStageStateRow } from '../lib/automation/flows-board';
import { t, tp } from '../i18n';
import { IconX } from './icons';

const ACTION_KIND_LABEL: Record<string, string> = {
  'create-pr': 'create PR',
  'merge-pr': 'merge PR',
  'advance-stage': 'advance stage',
};

const STATE_TONE_LABEL: Record<string, string> = {
  queued: 'queued',
  running: 'running',
  paused: 'blocked',
  failed: 'failed',
  succeeded: 'done',
  cancelled: 'cancelled',
};

export default function StepDrawer({ flow, stageIndex, inbox, onClose, onMutated }: {
  flow: Workflow;
  stageIndex: number;
  inbox: InboxPayload;
  onClose: () => void;
  /** Called after a successful operation so the board can re-read the projection. */
  onMutated: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<string>('');
  const [error, setError] = useState('');
  const [takeoverFor, setTakeoverFor] = useState<number | null>(null);
  const [takeoverTitle, setTakeoverTitle] = useState('');
  const [takeoverBody, setTakeoverBody] = useState('');

  const stage = flow.stages[stageIndex];
  const routes = useMemo(
    () => matchingStageProjections(flow, stageIndex, inbox.states),
    [flow, stageIndex, inbox.states],
  );
  const primary: WorkflowStageStateRow | undefined = routes[0];
  const queueItem: ActionQueueItem | undefined = useMemo(
    () => inbox.items.find(
      (item) => item.workflowId === flow.id
        && item.stageIndex === stageIndex
        && (primary ? item.source === primary.source : true),
    ),
    [inbox.items, flow.id, stageIndex, primary],
  );

  // One automation action per stage identity: prefer the pinned stageId over
  // the positional index (workflow-run.ts latestAutomationAction semantics).
  // The drawer shows the newest action as the primary block and folds the
  // rest into a collapsible history, mirroring the original's
  // automationDetailBlock rather than dumping every past run.
  const actions: AutomationActionRow[] = useMemo(() => {
    const scoped = inbox.automation.filter((action) => action.workflowId === flow.id);
    const stageId = stage.stageId ?? null;
    return scoped.filter((action) => (stageId ? action.stageId === stageId : action.stageIndex === stageIndex));
  }, [inbox.automation, flow.id, stage.stageId, stageIndex]);
  const latestAction = useMemo(
    () => [...actions].sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))[0],
    [actions],
  );
  const olderActions = useMemo(
    () => actions.filter((action) => action !== latestAction),
    [actions, latestAction],
  );

  const events = useMemo(
    () => inbox.events.filter(
      (event) => event.workflowId === flow.id && event.stageIndex === stageIndex,
    ).slice(0, 30),
    [inbox.events, flow.id, stageIndex],
  );

  const kind = primary?.pullState === 'merged' ? 'merged' : primary?.pullState === 'open' ? 'open' : 'not-created';
  const stateText = stageStateText(kind, primary?.checksState, Boolean(primary?.checksTotal));
  const pullNumber = queueItem?.pullNumber ?? primary?.pullNumber ?? null;

  async function runOp(key: string, op: () => Promise<unknown>, successMessage: string) {
    setBusy(key);
    setError('');
    try {
      await op();
      toast.notify(successMessage);
      onMutated();
    } catch (err) {
      const message = errorMessage(err);
      setError(message);
      toast.error(message);
    } finally {
      setBusy('');
    }
  }

  function enqueue(kind: 'create-pr' | 'merge-pr') {
    void runOp(kind, () => enqueueAutomation({
      workflowId: flow.id,
      stageIndex,
      source: primary?.source || stage.source,
      kind,
      idempotencyKey: `drawer-${flow.id}-${stageIndex}-${kind}-${Date.now().toString(36)}`,
    }), kind === 'create-pr' ? t('create PR queued') : t('merge queued'));
  }

  function rerun() {
    void runOp('rerun', () => rerunFailedActions({
      workflowId: flow.id,
      stageIndex,
      source: primary?.source || stage.source,
    }), t('Actions rerun requested'));
  }

  return (
    <div className="drawer-backdrop" onClick={onClose} role="presentation">
      <aside
        className="step-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`${flow.name} · ${tp('Step {index}', { index: stageIndex + 1 })}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="step-drawer-head">
          <div>
            <p className="drawer-eyebrow">{flow.repository}</p>
            <h2>{tp('Step {index}', { index: stageIndex + 1 })} · {stage.source} → {stage.target}</h2>
            <p className="drawer-state">{stateText}</p>
          </div>
          <button type="button" className="m-icon-btn" aria-label={t('Close')} onClick={onClose}>
            <IconX width={18} height={18} />
          </button>
        </header>

        {error ? <div className="drawer-error">{error}</div> : null}

        {pullNumber ? (
          <div className="drawer-section">
            <span className="drawer-label">PR</span>
            <a href={githubPullUrl(flow.repository, pullNumber)} target="_blank" rel="noreferrer">#{pullNumber}</a>
            {primary?.checksTotal ? (
              <span className="drawer-gate">{tp('checks {passed}/{total} {state}', {
                passed: primary.checksPassed ?? 0,
                total: primary.checksTotal,
                state: primary.checksState === 'success'
                  ? t('checks passed')
                  : primary.checksState === 'failure' ? t('checks failed') : t('checks running'),
              })}</span>
            ) : null}
          </div>
        ) : null}

        <div className="drawer-section drawer-actions">
          {primary?.pullState !== 'merged' && primary?.pullState !== 'open' ? (
            <button
              type="button"
              className="drawer-btn primary"
              disabled={busy !== ''}
              onClick={() => enqueue('create-pr')}
            >
              {busy === 'create-pr' ? t('Refreshing…') : t('create PR')}
            </button>
          ) : null}
          {primary?.pullState === 'open' ? (
            <button
              type="button"
              className="drawer-btn primary"
              disabled={busy !== ''}
              onClick={() => enqueue('merge-pr')}
            >
              {busy === 'merge-pr' ? t('Refreshing…') : t('merge PR')}
            </button>
          ) : null}
          <button
            type="button"
            className="drawer-btn"
            disabled={busy !== ''}
            onClick={rerun}
          >
            {busy === 'rerun' ? t('Refreshing…') : t('rerun Actions')}
          </button>
        </div>

        <div className="drawer-section">
          <span className="drawer-label">{t('Automation')}</span>
          {!latestAction ? (
            <p className="drawer-empty">{t('No automation actions on this step')}</p>
          ) : (
            <>
            <ul className="drawer-actions-list">
              {[latestAction].map((action) => {
                const presentation = automationActionPresentation({ state: action.state as AutomationActionState });
                const id = typeof action.id === 'number' ? action.id : Number(action.id);
                return (
                  <li key={`${action.id}`} className={`automation-row ${presentation.tone}`}>
                    <div className="automation-row-main">
                      <b>{t(ACTION_KIND_LABEL[action.kind ?? ''] ?? action.kind ?? '—')}</b>
                      <span className="automation-state">{t(STATE_TONE_LABEL[action.state] ?? action.state)}</span>
                      {action.message ? <small>{action.message}</small> : null}
                    </div>
                    <div className="automation-row-ops">
                      {action.state === 'queued' || action.state === 'running' || action.state === 'paused' ? (
                        <button
                          type="button"
                          className="drawer-btn small"
                          disabled={busy !== ''}
                          onClick={() => void runOp(`exec-${action.id}`, () => executeAutomationAction(id), t('action executed'))}
                        >
                          {t('execute')}
                        </button>
                      ) : null}
                      {action.state === 'failed' ? (
                        <button
                          type="button"
                          className="drawer-btn small"
                          disabled={busy !== ''}
                          onClick={() => void runOp(`regen-${action.id}`, () => regenerateAutomationMessage(id), t('message regeneration queued'))}
                        >
                          {t('regenerate message')}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="drawer-btn small"
                        disabled={busy !== ''}
                        onClick={() => setTakeoverFor(id)}
                      >
                        {t('take over')}
                      </button>
                    </div>
                    {takeoverFor === id ? (
                      <div className="takeover-form">
                        <input
                          value={takeoverTitle}
                          onChange={(event) => setTakeoverTitle(event.target.value)}
                          placeholder={t('takeover title')}
                          aria-label={t('takeover title')}
                        />
                        <textarea
                          value={takeoverBody}
                          onChange={(event) => setTakeoverBody(event.target.value)}
                          placeholder={t('takeover body (PR description)')}
                          aria-label={t('takeover body (PR description)')}
                          rows={4}
                        />
                        <div className="takeover-ops">
                          <button
                            type="button"
                            className="drawer-btn primary small"
                            disabled={busy !== ''}
                            onClick={() => {
                              void runOp(`takeover-${id}`, () => takeoverAutomationAction(id, takeoverTitle, takeoverBody), t('takeover saved'))
                                .then(() => setTakeoverFor(null));
                            }}
                          >
                            {t('save takeover')}
                          </button>
                          <button type="button" className="drawer-btn small" onClick={() => setTakeoverFor(null)}>
                            {t('Cancel')}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {olderActions.length ? (
              <details className="automation-history">
                <summary>{tp('{count} earlier actions', { count: olderActions.length })}</summary>
                <ul className="drawer-actions-list">
                  {olderActions.map((action) => (
                    <li key={`${action.id}`} className="automation-row muted">
                      <div className="automation-row-main">
                        <b>{t(ACTION_KIND_LABEL[action.kind ?? ''] ?? action.kind ?? '—')}</b>
                        <span className="automation-state">{t(STATE_TONE_LABEL[action.state] ?? action.state)}</span>
                        {action.message ? <small>{action.message}</small> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            </>
          )}
        </div>

        <div className="drawer-section">
          <span className="drawer-label">{t('Stage events')}</span>
          {events.length ? (
            <ol className="drawer-events">
              {events.map((event, index) => (
                <li key={index}>
                  <span>{event.message}</span>
                  <time>{event.occurredAt?.slice(0, 16).replace('T', ' ')}</time>
                </li>
              ))}
            </ol>
          ) : (
            <p className="drawer-empty">{t('No events yet')}</p>
          )}
        </div>
      </aside>
    </div>
  );
}
