// Flow board (Phase 3, P3-1): the pr-helper release-control lane board,
// rebuilt on React. Data comes from /api/flows/inbox (persisted projection
// fan-out); all board semantics (six filters, aggregate counters, lane step
// tones, run summary) live in src/lib/automation/flows-board.ts and are
// unit-tested against the original pr-helper behaviour there.
import { useCallback, useEffect, useMemo, useState, Fragment } from 'react';
import { fetchFlows, fetchInbox, type InboxPayload } from '../api/flows';
import { errorMessage } from '../lib/errors';
import {
  boardCounts,
  buildLaneModels,
  flowPullUrl,
  type BoardFilter,
  type BoardState,
} from '../lib/automation/flows-board';
import { t } from '../i18n';
import { IconRefresh, IconSearch } from './icons';

const FILTERS: BoardFilter[] = ['attention', 'running', 'all', 'failed', 'automation', 'archived'];

const FILTER_LABEL: Record<BoardFilter, string> = {
  attention: 'Needs attention',
  running: 'Running',
  all: 'Active',
  failed: 'Failed',
  automation: 'Automation blocked',
  archived: 'Archived',
};

/** Filter chip -> BoardCounts field ('all' renders the active-workflow count). */
const FILTER_COUNT: Record<BoardFilter, keyof ReturnType<typeof boardCounts>> = {
  attention: 'attention',
  running: 'running',
  all: 'active',
  failed: 'failed',
  automation: 'automationBlocked',
  archived: 'archived',
};

function StepCard({ lane, repository }: {
  lane: ReturnType<typeof buildLaneModels>[number]['steps'][number];
  repository: string;
}) {
  return (
    <div className={`lane-step ${lane.tone}`}>
      <div className="step-route">
        <span className="step-index">{lane.stageIndex + 1}</span>
        <b>{lane.source} → {lane.target}</b>
      </div>
      <small>
        {lane.label}
        {lane.pullNumber ? (
          <a href={flowPullUrl(repository, lane.pullNumber)} target="_blank" rel="noreferrer">
            {' '}#{lane.pullNumber}
          </a>
        ) : null}
      </small>
    </div>
  );
}

/**
 * Flow board page. Read-only in this slice: edit/archive/mute and the step
 * drawer arrive with P3-3/P3-4; refresh re-reads the persisted projection.
 */
export default function FlowBoard() {
  const [inbox, setInbox] = useState<InboxPayload | null>(null);
  const [workflows, setWorkflows] = useState<BoardState['workflows']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<BoardFilter>('all');
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setRefreshing(true);
    try {
      const [nextInbox, nextFlows] = await Promise.all([fetchInbox(), fetchFlows()]);
      setInbox(nextInbox);
      setWorkflows(nextFlows.workflows);
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(false); }, [load]);

  const state: BoardState = useMemo(() => ({
    workflows,
    states: inbox?.states ?? [],
    actionQueue: inbox?.items ?? [],
    automationActions: inbox?.automation ?? [],
  }), [inbox, workflows]);

  const counts = useMemo(() => boardCounts(state), [state]);
  const lanes = useMemo(() => buildLaneModels(state, filter, search, 'custom', 'asc'), [state, filter, search]);

  return (
    <div className="flow-board-page">
      <section className="board-head">
        <div className="board-title">
          <h1>{t('Flow board')}</h1>
          <p>{t('Release lanes across your repositories')}</p>
        </div>
        <label className="board-search">
          <IconSearch width={14} height={14} />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('Search flows')}
            aria-label={t('Search flows')}
          />
        </label>
        <button
          type="button"
          className="board-refresh"
          onClick={() => void load(true)}
          disabled={refreshing}
          aria-busy={refreshing}
        >
          <IconRefresh width={14} height={14} /> {refreshing ? t('Refreshing…') : t('Refresh')}
        </button>
      </section>

      {inbox?.readWarnings?.length ? (
        <details className="compact-notice">
          <summary>{t('Live reads degraded — GitHub App credentials not configured; showing persisted projection')}</summary>
          {inbox.readWarnings.map((warning, index) => (
            <p key={index}>{warning.source}: {warning.message}</p>
          ))}
        </details>
      ) : null}

      {error ? <div className="compact-notice is-error"><p>{error}</p></div> : null}
      {loading && !inbox ? <div className="compact-notice"><p>{t('Refreshing…')}</p></div> : null}

      <section className="board-summary" aria-label={t('Flow board')}>
        {FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            className={filter === key ? 'active' : ''}
            onClick={() => setFilter(key)}
          >
            <span>{counts[FILTER_COUNT[key]]}</span>
            {t(FILTER_LABEL[key])}
          </button>
        ))}
      </section>

      <section className="project-board">
        {lanes.length ? lanes.map((lane) => (
          <article key={lane.workflow.id} className={`project-lane${lane.workflow.archived ? ' is-archived' : ''}`}>
            <header className="lane-header">
              <div className="lane-title-block">
                {/* The original board shows repository as eyebrow and name as
                    the title; flows named after their repository would render
                    the identity twice, so the eyebrow only survives a rename. */}
                {lane.workflow.name.toLocaleLowerCase() !== lane.workflow.repository.toLocaleLowerCase() ? (
                  <p className="lane-eyebrow">{lane.workflow.repository}</p>
                ) : null}
                <h2>
                  {lane.workflow.name}
                  {lane.workflow.archived ? <span className="lane-badge">{t('Archived')}</span> : null}
                  {lane.muted ? <span className="lane-badge">{t('Muted')}</span> : null}
                </h2>
              </div>
              <span className="lane-run">
                <i className={`tone-dot ${lane.summary.tone}`} aria-hidden="true" />
                <span className="run-text">{lane.summary.text}</span>
              </span>
            </header>
            <div className="lane-track">
              {lane.steps.map((step, index) => (
                <Fragment key={`${step.stageIndex}:${step.source}`}>
                  {index > 0 ? <span className="lane-connector" aria-hidden="true">→</span> : null}
                  <StepCard lane={step} repository={lane.workflow.repository} />
                </Fragment>
              ))}
            </div>
          </article>
        )) : (
          <article className="board-empty">
            <h3>{workflows.length ? t('No flows match this filter') : t('No flows yet — create one from a repository')}</h3>
            {workflows.length ? (
              <button type="button" className="ghost" onClick={() => setFilter('all')}>{t('Show all flows')}</button>
            ) : null}
          </article>
        )}
      </section>
    </div>
  );
}
