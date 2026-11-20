// Failure center (Phase 3, P3-5): the aggregated failure panel above the
// board — check failures & approvals, post-merge deployment failures, and
// blocked automation actions. Operations ride the landed write routes
// (rerun-actions) and the step drawer for everything else.
import { useCallback, useState } from 'react';
import { useToast } from './ui';
import { errorMessage } from '../lib/errors';
import { failureSections, type FailureItem } from '../lib/automation/flows-failures';
import { rerunFailedActions } from '../api/flows';
import type { BoardState } from '../lib/automation/flows-board';
import { githubPullUrl } from '../lib/domain';
import PullReference from './PullReference';
import { t, tp } from '../i18n';

function ItemRow({ item, flowRepository, busy, onRerun, onOpenDrawer, onTakeover, onRepair }: {
  item: FailureItem;
  flowRepository: string;
  busy: string;
  onRerun?: (item: FailureItem) => void;
  onOpenDrawer: (item: FailureItem) => void;
  onTakeover?: (item: FailureItem) => void;
  onRepair?: (item: FailureItem) => void;
}) {
  const retry = item.recovery;
  return (
    <li className={`fc-item ${item.tone}`}>
      <span className="fc-icon" aria-hidden="true">{item.icon}</span>
      <div className="fc-main">
        <b>{item.workflowName}</b>
        <small>
          {item.route}
          {item.pullNumber ? (
            <> · <PullReference url={githubPullUrl(flowRepository, item.pullNumber)} label={`#${item.pullNumber}`} /></>
          ) : null}
        </small>
        <p>{item.message}</p>
        {retry?.badge ? <span className="fc-recovery-badge">{retry.badge}</span> : null}
      </div>
      <div className="fc-ops">
        {item.takeoverActionId && onTakeover ? (
          <button type="button" className="drawer-btn small" onClick={() => onTakeover(item)}>
            {t('take over')}
          </button>
        ) : null}
        {item.recovery && onRepair ? (
          <button
            type="button"
            className="drawer-btn small"
            disabled={busy !== ''}
            onClick={() => onRepair(item)}
          >
            {t('Codex repair context')}
          </button>
        ) : null}
        {onRerun ? (
          <button
            type="button"
            className="drawer-btn small"
            disabled={busy !== '' || retry?.retryDisabled}
            title={retry?.retryDisabled ? t('rerun blocked by recovery policy') : undefined}
            onClick={() => onRerun(item)}
          >
            {busy === item.key ? t('Refreshing…') : t('rerun Actions')}
          </button>
        ) : null}
        <button type="button" className="drawer-btn small" onClick={() => onOpenDrawer(item)}>
          {t('step details')}
        </button>
      </div>
    </li>
  );
}

export default function FailureCenter({ state, onOpenDrawer, onMutated, onResolved, onTakeover, onRepair }: {
  state: BoardState;
  onOpenDrawer: (flowId: string, stageIndex: number) => void;
  onMutated: () => void;
  /** Marks the step handled locally so the board hides it until the projection catches up. */
  onResolved?: (workflowId: string, stageIndex: number, source: string) => void;
  /** Opens the step drawer preloaded with the paused create-pr action. */
  onTakeover?: (item: FailureItem) => void;
  /** Opens the Codex repair modal for a check-failure row. */
  onRepair?: (item: FailureItem) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const sections = failureSections(state);

  const rerun = useCallback((item: FailureItem) => {
    setBusy(item.key);
    setError('');
    rerunFailedActions({
      workflowId: item.workflowId,
      stageIndex: item.stageIndex,
      source: item.source,
    })
      .then(() => {
        toast.notify(t('Actions rerun requested'));
        onResolved?.(item.workflowId, item.stageIndex, item.source);
        onMutated();
      })
      .catch((err) => {
        // Inline banner only — the section already shows the failure; a
        // second toast for the same event was double-reporting.
        setError(errorMessage(err));
      })
      .finally(() => setBusy(''));
  }, [state.workflows, toast, onMutated, onResolved]);

  if (!sections.total) return null;

  const repositoryFor = (item: FailureItem) => state.workflows.find((w) => w.id === item.workflowId)?.repository ?? '';

  return (
    <section className="failure-center">
      <div className="fc-head">
        <p className="fc-eyebrow">{t('Needs attention')}</p>
        <span className="fc-count">{tp('{count} items', { count: sections.total })}</span>
      </div>
      {error ? <div className="drawer-error">{error}</div> : null}
      <ul>
        {sections.items.map((item) => (
          <ItemRow
            key={item.key}
            item={item}
            flowRepository={repositoryFor(item)}
            busy={busy}
            onRerun={(target) => rerun(target)}
            onRepair={(target) => onRepair?.(target)}
            onOpenDrawer={(target) => onOpenDrawer(target.workflowId, target.stageIndex)}
          />
        ))}
        {sections.deployItems.map((item) => (
          <ItemRow
            key={item.key}
            item={item}
            flowRepository={repositoryFor(item)}
            busy={busy}
            onOpenDrawer={(target) => onOpenDrawer(target.workflowId, target.stageIndex)}
          />
        ))}
        {sections.automationItems.map((item) => (
          <ItemRow
            key={item.key}
            item={item}
            flowRepository={repositoryFor(item)}
            busy={busy}
            onTakeover={onTakeover ? (target) => onTakeover(target) : undefined}
            onOpenDrawer={(target) => onOpenDrawer(target.workflowId, target.stageIndex)}
          />
        ))}
      </ul>
    </section>
  );
}
