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
import { t, tp } from '../i18n';

function ItemRow({ item, flowRepository, busy, onRerun, onOpenDrawer }: {
  item: FailureItem;
  flowRepository: string;
  busy: string;
  onRerun?: (item: FailureItem) => void;
  onOpenDrawer: (item: FailureItem) => void;
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
            <> · <a href={githubPullUrl(flowRepository, item.pullNumber)} target="_blank" rel="noreferrer">#{item.pullNumber}</a></>
          ) : null}
        </small>
        <p>{item.message}</p>
        {retry?.badge ? <span className="fc-recovery-badge">{retry.badge}</span> : null}
      </div>
      <div className="fc-ops">
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

export default function FailureCenter({ state, onOpenDrawer, onMutated }: {
  state: BoardState;
  onOpenDrawer: (flowId: string, stageIndex: number) => void;
  onMutated: () => void;
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
        onMutated();
      })
      .catch((err) => {
        const message = errorMessage(err);
        setError(message);
        toast.error(message);
      })
      .finally(() => setBusy(''));
  }, [state.workflows, toast, onMutated]);

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
            onOpenDrawer={(target) => onOpenDrawer(target.workflowId, target.stageIndex)}
          />
        ))}
      </ul>
    </section>
  );
}
