// Flow detail (Phase 3, P3-2): read-only detail page behind a board lane —
// progress bar, per-stage timeline with projected statuses and events, and
// the stage's automation flags. Operations (create/merge/repair) arrive with
// the step drawer (P3-3); live revalidation arrives with P2-1 credentials.
import { useMemo } from 'react';
import {
  buildStageDetails,
  flowProgress,
  type StageEventRow,
} from '../lib/automation/flows-detail';
import { workflowSummary } from '../lib/automation/workflow';
import { githubPullUrl } from '../lib/domain';
import type { BoardState } from '../lib/automation/flows-board';
import { t, tp } from '../i18n';

/** "M/D HH:mm" in local time, matching the board's updated stamp. */
function formatEventTime(occurredAt: string): string {
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

function AutomationChip({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <span className={`detail-auto-chip${enabled ? ' enabled' : ''}`}>
      {label} · {t(enabled ? 'on' : 'off')}
    </span>
  );
}

export default function FlowDetail({ flowId, state, events, onClose }: {
  flowId: string;
  state: BoardState;
  events: readonly StageEventRow[];
  onClose: () => void;
}) {
  const flow = useMemo(
    () => state.workflows.find((workflow) => workflow.id === flowId),
    [state.workflows, flowId],
  );
  const stages = useMemo(
    () => (flow ? buildStageDetails(state, flow, events) : []),
    [state, flow, events],
  );
  const progress = useMemo(() => (flow ? flowProgress(state, flow) : null), [state, flow]);

  if (!flow) {
    return (
      <div className="flow-detail-page">
        <button type="button" className="ghost" onClick={onClose}>← {t('Back')}</button>
        <p className="compact-notice">{t('Waiting for the projection…')}</p>
      </div>
    );
  }
  const summary = workflowSummary(flow);
  const progressPct = progress && progress.total ? Math.round((progress.completed / progress.total) * 100) : 0;

  return (
    <div className="flow-detail-page">
      <section className="page-head detail-page-head">
        <button type="button" className="ghost" onClick={onClose}>← {t('Back')}</button>
        <div className="detail-head-main">
          {flow.name.toLocaleLowerCase() !== flow.repository.toLocaleLowerCase() ? (
            <p className="detail-eyebrow">{flow.repository}</p>
          ) : null}
          <h1>{flow.name}</h1>
          <p className="detail-route">{summary.route}</p>
        </div>
      </section>

      <section className="detail-progress">
        <span className="detail-progress-label">{t('Progress')} {progress?.completed ?? 0}/{progress?.total ?? flow.stages.length}</span>
        <div className="detail-progress-bar">
          {flow.stages.map((stage, index) => (
            <i
              key={stage.stageId ?? index}
              className={progress?.nodes[index] ?? 'idle'}
              style={{ left: `${(index / Math.max(flow.stages.length, 1)) * 100}%` }}
            />
          ))}
          <span className="detail-progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
      </section>

      <section className="detail-stages">
        {stages.map((stage) => (
          <article key={stage.index} className={`detail-stage ${stage.tone}`}>
            <div className="detail-stage-head">
              <span className="step-index">{stage.index + 1}</span>
              <b>{stage.source} → {stage.target}</b>
              {stage.pullNumber ? (
                <a href={stage.pullUrl ?? githubPullUrl(flow.repository, stage.pullNumber)} target="_blank" rel="noreferrer">
                  #{stage.pullNumber}
                </a>
              ) : null}
              <i className={`tone-dot ${stage.tone}`} aria-hidden="true" />
              <span className="detail-state">{stage.stateText}</span>
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
