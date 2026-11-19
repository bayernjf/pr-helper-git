// Flow detail (Phase 3, P3-2): read-only detail page behind a board lane —
// progress bar, per-stage timeline with projected statuses and events, and
// the stage's automation flags. Operations (create/merge/repair) arrive with
// the step drawer (P3-3); live revalidation arrives with P2-1 credentials.
import { useMemo, useState } from 'react';
import { useToast, useConfirm } from './ui';
import { deleteFlowFromServer } from '../api/flows';
import {
  buildStageDetails,
  flowProgress,
  nextActionSummary,
  stageProgressTooltip,
  type NextActionKind,
  type StageEventRow,
} from '../lib/automation/flows-detail';
import type { StageProgressStatus } from '../lib/automation/workflow-run';
import { workflowSummary } from '../lib/automation/workflow';
import { githubPullUrl } from '../lib/domain';
import { errorMessage } from '../lib/errors';
import { formatRelative } from '../lib/format';
import type { BoardState } from '../lib/automation/flows-board';
import { getLocale, t, tp } from '../i18n';
import FlowEditor from './FlowEditor';
import PullReference from './PullReference';

const NODE_LABEL: Record<StageProgressStatus, string> = {
  succeeded: 'done',
  failed: 'failed',
  blocked: 'paused',
  'waiting-gates': 'waiting for gates',
  running: 'running',
  ready: 'actionable',
  locked: 'waiting for previous',
  idle: 'waiting for sync',
};

const NEXT_ACTION_TEXT: Record<NextActionKind, string> = {
  notStarted: 'Monitoring not started yet',
  gateFailed: 'A gate failed and needs attention',
  canCheck: 'Ready to check the next PR',
  synced: 'Flow status synced',
};

/** "M/D HH:mm" in local time, matching the board's updated stamp. */
function formatEventTime(occurredAt: string): string {
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(getLocale() === 'zh' ? 'zh-CN' : 'en-US', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

function AutomationChip({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <span className={`detail-auto-chip${enabled ? ' enabled' : ''}`}>
      {label} · {t(enabled ? 'on' : 'off')}
    </span>
  );
}

export default function FlowDetail({ flowId, state, events, inbox, onClose, onOpenDrawer, onSaved, onDeleted }: {
  flowId: string;
  state: BoardState;
  events: readonly StageEventRow[];
  inbox?: import('../api/flows').InboxPayload;
  onClose: () => void;
  /** Opens the step drawer for one stage (P3-3 operations). */
  onOpenDrawer?: (stageIndex: number) => void;
  /** When present, the flow can be edited; called with the saved version. */
  onSaved?: (saved: import('../lib/automation/workflow').Workflow) => void;
  /** Called after a confirmed local delete; the board removes the lane. */
  onDeleted?: (id: string) => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const flow = useMemo(
    () => state.workflows.find((workflow) => workflow.id === flowId),
    [state.workflows, flowId],
  );
  const [editing, setEditing] = useState(false);
  const stages = useMemo(
    () => (flow ? buildStageDetails(state, flow, events) : []),
    [state, flow, events],
  );
  const progress = useMemo(() => (flow ? flowProgress(state, flow) : null), [state, flow]);
  const nextAction = useMemo(() => (flow ? nextActionSummary(state, flow) : 'notStarted'), [state, flow]);
  const recentRuns = useMemo(
    () => (inbox?.runs ?? []).filter((run) => run.workflowId === flowId).slice(0, 10),
    [inbox?.runs, flowId],
  );

  if (!flow) {
    return (
      <div className="flow-detail-page">
        <button type="button" className="ghost" onClick={onClose}>← {t('Back')}</button>
        <p className="compact-notice">{t('Waiting for the projection…')}</p>
      </div>
    );
  }
  if (editing) {
    return (
      <FlowEditor
        workflow={flow}
        state={state}
        inbox={inbox}
        onClose={() => setEditing(false)}
        onSaved={(saved) => onSaved?.(saved)}
      />
    );
  }
  const summary = workflowSummary(flow);
  const headline = !progress?.synced
    ? t('Waiting for status sync')
    : progress.currentIndex === null
      ? tp('All done · {total} steps, waiting for new commits', { total: progress.total })
      : tp('Step {step} of {total} · {completed} completed', {
        step: progress.currentIndex + 1,
        total: progress.total,
        completed: progress.completed,
      });

  return (
    <div className="flow-detail-page">
      <section className="page-head detail-page-head">
        <button type="button" className="ghost" onClick={onClose}>← {t('Back')}</button>
        <div className="detail-head-main">
          {onSaved ? <button type="button" className="drawer-btn" onClick={() => setEditing(true)}>{t('Edit flow')}</button> : null}
          {onDeleted ? (
            <button
              type="button"
              className="drawer-btn danger"
              onClick={async () => {
                const confirmed = await confirm({
                  title: tp('Delete {name}?', { name: flow.name }),
                  detail: t('This removes the flow from the local database. It cannot be undone.'),
                  confirmLabel: t('Delete'),
                  danger: true,
                });
                if (!confirmed) return;
                try {
                  await deleteFlowFromServer(flow.id);
                  toast.notify(t('Flow deleted'));
                  onDeleted(flow.id);
                } catch (err) {
                  toast.error(errorMessage(err));
                }
              }}
            >
              {t('Delete flow')}
            </button>
          ) : null}
          {flow.name.toLocaleLowerCase() !== flow.repository.toLocaleLowerCase() ? (
            <p className="detail-eyebrow">{flow.repository}</p>
          ) : null}
          <h1>{flow.name}</h1>
          <p className="detail-route">{summary.route}</p>
        </div>
        <aside className={`detail-next-action is-${nextAction}`}>
          <p className="detail-eyebrow">{t('Next action')}</p>
          <h2>{t(NEXT_ACTION_TEXT[nextAction])}</h2>
        </aside>
      </section>

      <section className="detail-progress flow-progress">
        <div className="flow-progress-head">
          <span className="detail-progress-label">{t('Flow progress')}</span>
          <span className="flow-progress-headline">{headline}</span>
        </div>
        <div className="flow-progress-nodes">
          {flow.stages.map((stage, index) => {
            const status = progress?.nodes[index] ?? 'idle';
            const isCurrent = progress?.synced && progress.currentIndex === index;
            return (
              <button
                key={stage.stageId ?? index}
                type="button"
                className={`fp-node is-${status}${isCurrent ? ' is-current' : ''}`}
                disabled={!onOpenDrawer}
                title={stageProgressTooltip(state, flow, index)}
                aria-label={`${tp('Step {step}', { step: index + 1 })} · ${t(NODE_LABEL[status])}`}
                onClick={() => onOpenDrawer?.(index)}
              >
                <span className="fp-node-index">{index + 1}</span>
                <span className="fp-node-status">{t(NODE_LABEL[status])}</span>
              </button>
            );
          })}
        </div>
        {progress?.next && progress.synced ? (
          <p className="flow-progress-next">
            <span>{tp('Next · step {step}', { step: progress.next.index + 1 })}</span>
            {progress.next.reason ? <span className="flow-progress-next-reason">{progress.next.reason}</span> : null}
          </p>
        ) : null}
        {progress?.syncedAt ? (
          <p className="flow-progress-sync">{tp('Server reconciliation · {time}', { time: formatRelative(progress.syncedAt) })}</p>
        ) : null}
      </section>

      {recentRuns.length ? (
        <section className="detail-runs">
          <span className="detail-events-label">{t('Recent runs')}</span>
          <ol>
            {recentRuns.map((run) => (
              <li key={run.id}>
                <b>{run.source} → {run.target}</b>
                {run.pullNumber ? (
                  <PullReference url={githubPullUrl(flow.repository, run.pullNumber)} label={`#${run.pullNumber}`} />
                ) : null}
                <span>{run.state}</span>
                <time>{formatEventTime(run.startedAt ?? '')}</time>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className="detail-stages">
        {stages.map((stage) => (
          <article key={stage.index} className={`detail-stage ${stage.tone}`}>
            <div className="detail-stage-head">
              <span className="step-index">{stage.index + 1}</span>
              <b>{stage.source} → {stage.target}</b>
              {stage.pullNumber ? (
                <PullReference
                  url={stage.pullUrl ?? githubPullUrl(flow.repository, stage.pullNumber)}
                  label={`#${stage.pullNumber}`}
                />
              ) : null}
              <i className={`tone-dot ${stage.tone}`} aria-hidden="true" />
              <span className="detail-state">{stage.stateText}</span>
              {onOpenDrawer ? (
                <button
                  type="button"
                  className="drawer-btn small"
                  onClick={() => onOpenDrawer(stage.index)}
                >
                  {t('step details')}
                </button>
              ) : null}
            </div>

            {stage.gates.length ? (
              <div className="detail-gates">
                {stage.gates.map((gate, gateIndex) => <span key={gateIndex} className="detail-gate">{gate}</span>)}
              </div>
            ) : null}

            {stage.dynamic ? (
              <div className="detail-routes">
                {stage.routes.map((route) => (
                  <div key={route.source} className="detail-route-row">
                    <i className={`tone-dot ${route.tone}`} aria-hidden="true" />
                    <b>{route.source}</b>
                    <span>{route.label}</span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="detail-automation">
              <span className="detail-automation-label">{t('Automation')}</span>
              <AutomationChip label={tp('auto-create (≥{threshold} commits)', { threshold: stage.automation.threshold })} enabled={stage.automation.autoCreate} />
              <AutomationChip label={t('auto-merge')} enabled={stage.automation.autoMerge} />
              <AutomationChip label={t('auto-advance')} enabled={stage.automation.autoAdvance} />
            </div>

            <div className="detail-events">
              <span className="detail-events-label">{t('Stage events')}</span>
              {stage.events.length ? (
                <ol>
                  {stage.events.map((event, eventIndex) => (
                    <li key={eventIndex}>
                      <span>{event.message}</span>
                      <time>{formatEventTime(event.occurredAt)}</time>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="detail-no-events">{t('No events yet')}</p>
              )}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
