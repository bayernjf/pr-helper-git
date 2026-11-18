// Flow board (Phase 3, P3-1): the pr-helper release-control lane board,
// rebuilt on React. Data comes from /api/flows/inbox (persisted projection
// fan-out); all board semantics (six filters, aggregate counters, lane step
// tones, run summary) live in src/lib/automation/flows-board.ts and are
// unit-tested against the original pr-helper behaviour there.
import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from 'react';
import { fetchFlows, fetchInbox, type InboxPayload } from '../api/flows';
import { errorMessage } from '../lib/errors';
import {
  boardCounts,
  buildLaneModels,
  flowPullUrl,
  type BoardFilter,
  type BoardState,
} from '../lib/automation/flows-board';
import { useToast, useConfirm } from './ui';
import { t, tp } from '../i18n';
import { saveWorkflowToServer } from '../api/flows';
import CodexRepairModal from './CodexRepairModal';
import FailureCenter from './FailureCenter';
import FlowEditor from './FlowEditor';
import { createWorkflow, moveWorkflowToPosition, sortWorkflowsForView, type Workflow } from '../lib/automation/workflow';
import FlowDetail from './FlowDetail';
import FlowAuditModal from './FlowAuditModal';
import FlowPreflightModal from './FlowPreflightModal';
import TeamsModal from './TeamsModal';
import PullReference from './PullReference';
import StepDrawer from './StepDrawer';
import { IconRefresh, IconSearch } from './icons';

const FILTERS: BoardFilter[] = ['attention', 'running', 'all', 'failed', 'automation', 'archived'];

const SORT_LABEL: Record<'custom' | 'name' | 'createdAt', string> = {
  custom: 'custom order',
  name: 'name',
  createdAt: 'created',
};

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

function StepCard({ lane, repository, onOpen }: {
  lane: ReturnType<typeof buildLaneModels>[number]['steps'][number];
  repository: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={`lane-step ${lane.tone}`}
      onClick={onOpen}
      title={tp('open {name} — step {index}', { name: repository, index: lane.stageIndex + 1 })}
    >
      <div className="step-route">
        <span className="step-index">{lane.stageIndex + 1}</span>
        <b>{lane.source} → {lane.target}</b>
      </div>
      <small>
        {lane.label}
        {lane.pullNumber ? (
          <PullReference
            url={flowPullUrl(repository, lane.pullNumber)}
            label={`#${lane.pullNumber}`}
          />
        ) : null}
      </small>
    </button>
  );
}

/**
 * Flow board page: board filters, archive/restore + mute/unmute (P3-12),
 * sync-health strip and flows audit entry (P3-14), and return-highlight
 * (P3-16). Page entry and focus return read the persisted projection; the
 * explicit Refresh action reconciles live on the server.
 */
export default function FlowBoard() {
  const toast = useToast();
  const confirm = useConfirm();
  const [laneBusy, setLaneBusy] = useState('');
  const [sortError, setSortError] = useState('');
  const [inbox, setInbox] = useState<InboxPayload | null>(null);
  const [workflows, setWorkflows] = useState<BoardState['workflows']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<BoardFilter>('all');
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const [collapsedLanes, setCollapsedLanes] = useState<string[]>([]);
  const [returnHighlight, setReturnHighlight] = useState<string | null>(null);
  const [drawerStage, setDrawerStage] = useState<{ flowId: string; stageIndex: number } | null>(null);
  const [repairTarget, setRepairTarget] = useState<{ flowId: string; stageIndex: number; source: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [teamsOpen, setTeamsOpen] = useState(false);
  const [preflightFlowId, setPreflightFlowId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<'custom' | 'name' | 'createdAt'>('custom');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  /** Timestamp of the last successful projection read; focus/visibility reload is TTL-gated. */
  const lastLoadedAt = useRef(0);

  useEffect(() => {
    if (!returnHighlight) return undefined;
    const timer = window.setTimeout(() => setReturnHighlight(null), 1600);
    return () => window.clearTimeout(timer);
  }, [returnHighlight]);

  const closeDetail = useCallback(() => {
    const flowId = selectedFlowId;
    setSelectedFlowId(null);
    if (flowId) setReturnHighlight(flowId);
  }, [selectedFlowId]);

  const load = useCallback(async (showSpinner: boolean, reconcile = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const [nextInbox, nextFlows] = await Promise.all([
        fetchInbox({ refresh: reconcile }),
        fetchFlows(),
      ]);
      setInbox(nextInbox);
      setWorkflows(nextFlows.workflows);
      setError('');
      lastLoadedAt.current = Date.now();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(false); }, [load]);

  // Page entry and returning to the tab render the persisted projection; a
  // reload is only worth a request once the snapshot is older than 30s. Live
  // reconciliation stays on the explicit Refresh action.
  useEffect(() => {
    const maybeReload = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastLoadedAt.current < 30_000) return;
      void load(false, false);
    };
    window.addEventListener('focus', maybeReload);
    document.addEventListener('visibilitychange', maybeReload);
    return () => {
      window.removeEventListener('focus', maybeReload);
      document.removeEventListener('visibilitychange', maybeReload);
    };
  }, [load]);

  const state: BoardState = useMemo(() => ({
    workflows,
    states: inbox?.states ?? [],
    actionQueue: inbox?.items ?? [],
    automationActions: inbox?.automation ?? [],
    recoveryStatuses: inbox?.recoveryStatuses ?? [],
  }), [inbox, workflows]);

  const counts = useMemo(() => boardCounts(state), [state]);
  const lanes = useMemo(
    () => buildLaneModels(state, filter, search, sortMode, sortDirection),
    [state, filter, search, sortMode, sortDirection],
  );
  const moveLaneTo = useCallback((flowId: string, to: number) => {
    const order = state.workflows.map((w) => w.id);
    const from = order.indexOf(flowId);
    const clamped = Math.min(order.length - 1, Math.max(0, to));
    if (from === -1 || from === clamped) return;
    const ordered = moveWorkflowToPosition(state.workflows, flowId, clamped);
    setWorkflows(sortWorkflowsForView(ordered, 'custom', 'asc'));
    // Persist the new custom order through the editor save route.
    const moved = ordered.find((workflow) => workflow.id === flowId);
    if (moved) {
      // Keep the optimistic local order but surface rollback visibly.
      saveWorkflowToServer(moved)
        .then(() => setSortError(''))
        .catch((err) => {
          setSortError(`${moved.name}: ${errorMessage(err)}`);
          toast.error(errorMessage(err));
        });
    }
  }, [state.workflows, toast]);

  const moveLane = useCallback(
    (flowId: string, delta: number) => {
      const from = state.workflows.findIndex((w) => w.id === flowId);
      moveLaneTo(flowId, from + delta);
    },
    [state.workflows, moveLaneTo],
  );

  const setLanePosition = useCallback(
    (flowId: string, position: number) => moveLaneTo(flowId, position - 1),
    [state.workflows, moveLaneTo],
  );

  const setLaneFlag = useCallback(async (
    workflow: Workflow,
    patch: Pick<Workflow, 'archived' | 'muted'> | { archived: true } | { muted: true },
    message: string,
  ) => {
    setLaneBusy(workflow.id);
    try {
      // PUT the full workflow so the server's optimistic-version guard and the
      // stage/audit projections stay consistent with the archive/mute column.
      const saved = await saveWorkflowToServer({ ...workflow, ...patch });
      setWorkflows((current) => current.map((item) => (item.id === saved.id ? saved : item)));
      toast.notify(t(message));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLaneBusy('');
    }
  }, [toast]);

  if (creating) {
    return (
      <FlowEditor
        initialDraft={createWorkflow('', 'dev', 'main')}
        state={state}
        inbox={inbox ?? undefined}
        onClose={() => setCreating(false)}
        onSaved={(saved) => {
          setWorkflows((current) => [...current, saved]);
          setSelectedFlowId(saved.id);
        }}
      />
    );
  }

  if (selectedFlowId) {
    return (
      <>
        <FlowDetail
          flowId={selectedFlowId}
          state={state}
          events={inbox?.events ?? []}
          inbox={inbox ?? undefined}
          onClose={closeDetail}
          onOpenDrawer={(stageIndex) => setDrawerStage({ flowId: selectedFlowId, stageIndex })}
          onSaved={(saved) => {
            // P3-11: a repository change saves a *new* flow, so append it
            // instead of mapping over ids that only covers the original.
            setWorkflows((current) => (current.some((w) => w.id === saved.id)
              ? current.map((w) => (w.id === saved.id ? saved : w))
              : [...current, saved]));
            setSelectedFlowId(saved.id);
          }}
          onDeleted={(id) => {
            setWorkflows((current) => current.filter((workflow) => workflow.id !== id));
            setSelectedFlowId(null);
            void load(true);
          }}
        />
        {drawerStage && inbox ? (
          <StepDrawer
            flow={state.workflows.find((w) => w.id === drawerStage.flowId)!}
            stageIndex={drawerStage.stageIndex}
            inbox={inbox}
            onClose={() => setDrawerStage(null)}
            onMutated={() => void load(true)}
          />
        ) : null}
      </>
    );
  }

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
        <button type="button" className="drawer-btn" onClick={() => setAuditOpen(true)}>
          {t('Audit log')}
        </button>
        <button type="button" className="drawer-btn" onClick={() => setTeamsOpen(true)}>
          {t('Teams')}
        </button>
        <button type="button" className="drawer-btn primary" onClick={() => setCreating(true)}>
          {t('New flow')}
        </button>
        <button
          type="button"
          className="board-refresh"
          onClick={() => void load(true, true)}
          disabled={refreshing}
          aria-busy={refreshing}
        >
          <IconRefresh width={14} height={14} /> {refreshing ? t('Refreshing…') : t('Refresh')}
        </button>
      </section>

      {inbox?.syncHealth ? (
        <section className="sync-health">
          <span className="sync-health-label">{t('Sync health')}</span>
          {inbox.syncHealth.lastReconciliation ? (
            <span className={inbox.syncHealth.lastReconciliation.state === 'completed' ? 'ok' : 'warn'}>
              {tp('last reconcile: {state} · {count} stages', {
                state: inbox.syncHealth.lastReconciliation.state,
                count: inbox.syncHealth.lastReconciliation.stagesReconciled,
              })}
            </span>
          ) : <span className="warn">{t('no reconciliation yet')}</span>}
          <span className={inbox.syncHealth.stages.some((stage) => stage.stale) ? 'warn' : 'ok'}>
            {tp('{count} stale stage(s)', { count: inbox.syncHealth.stages.filter((stage) => stage.stale).length })}
          </span>
          <span>{tp('{count} webhook(s) / 24h', { count: inbox.syncHealth.webhookDeliveriesLast24h })}</span>
          {inbox.syncHealth.lastReconciliation?.interrupted ? <span className="warn">{t('reconcile interrupted')}</span> : null}
        </section>
      ) : null}

      {inbox ? (
        <FailureCenter
          state={state}
          onOpenDrawer={(flowId, stageIndex) => setDrawerStage({ flowId, stageIndex })}
          onMutated={() => void load(true)}
          onRepair={(item) => setRepairTarget({ flowId: item.workflowId, stageIndex: item.stageIndex, source: item.source })}
        />
      ) : null}

      {inbox?.readWarnings?.length ? (
        <details className="compact-notice">
          <summary>{t('Live reads degraded — GitHub App credentials not configured; showing persisted projection')}</summary>
          {inbox.readWarnings.map((warning, index) => (
            <p key={index}>{warning.source}: {warning.message}</p>
          ))}
        </details>
      ) : null}

      {error ? <div className="compact-notice is-error"><p>{error}</p></div> : null}
      {sortError ? <div className="compact-notice is-error"><p>{sortError}</p></div> : null}
      {loading && !inbox ? <div className="compact-notice"><p>{t('Refreshing…')}</p></div> : null}

      <section className="board-summary" aria-label={t('Flow board')}>
        <span className="board-sort">
          {(['custom', 'name', 'createdAt'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={sortMode === mode ? 'active' : ''}
              onClick={() => {
                if (sortMode === mode && mode !== 'custom') {
                  setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
                } else {
                  setSortMode(mode);
                }
              }}
            >
              {t(SORT_LABEL[mode])}{sortMode === mode && mode !== 'custom' ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ''}
            </button>
          ))}
        </span>
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
        {lanes.length ? lanes.map((lane, index) => (
          <article key={lane.workflow.id} className={`project-lane${lane.workflow.archived ? ' is-archived' : ''}${returnHighlight === lane.workflow.id ? ' is-return-highlight' : ''}`}>
            <header className="lane-header">
              <button
                type="button"
                className="lane-title-block"
                onClick={() => setSelectedFlowId(lane.workflow.id)}
                title={t('Flow board')}
              >
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
              </button>
              <div className="lane-actions">
                <button
                  type="button"
                  className="drawer-btn small"
                  onClick={() => setPreflightFlowId(lane.workflow.id)}
                >
                  {t('preflight')}
                </button>
                <button
                  type="button"
                  className="drawer-btn small"
                  disabled={laneBusy === lane.workflow.id}
                  onClick={async () => {
                    const archiving = !lane.workflow.archived;
                    if (archiving) {
                      const confirmed = await confirm({
                        title: tp('Archive {name}?', { name: lane.workflow.name }),
                        detail: t('Archiving stops its automation and hides it from the active filters; it can be restored later.'),
                        confirmLabel: t('archive'),
                        danger: true,
                      });
                      if (!confirmed) return;
                    }
                    await setLaneFlag(
                      lane.workflow,
                      { archived: archiving ? true : undefined },
                      archiving ? 'Flow archived' : 'Flow restored',
                    );
                  }}
                >
                  {lane.workflow.archived ? t('restore') : t('archive')}
                </button>
                <button
                  type="button"
                  className="drawer-btn small"
                  disabled={laneBusy === lane.workflow.id}
                  onClick={() => setLaneFlag(
                    lane.workflow,
                    { muted: lane.muted ? undefined : true },
                    lane.muted ? 'Flow unmuted' : 'Flow muted',
                  )}
                >
                  {lane.muted ? t('unmute') : t('mute')}
                </button>
              </div>
              <span className="lane-run">
                <button
                  type="button"
                  className="lane-move-btn"
                  aria-expanded={!collapsedLanes.includes(lane.workflow.id)}
                  aria-label={collapsedLanes.includes(lane.workflow.id) ? t('Expand') : t('Collapse')}
                  title={collapsedLanes.includes(lane.workflow.id) ? t('Expand') : t('Collapse')}
                  onClick={() => setCollapsedLanes((current) => (current.includes(lane.workflow.id) ? current.filter((id) => id !== lane.workflow.id) : [...current, lane.workflow.id]))}
                >
                  {collapsedLanes.includes(lane.workflow.id) ? '+' : '–'}
                </button>
                {sortMode === 'custom' && filter === 'all' && !search ? (
                  <span className="lane-move">
                    <span className="lane-position-badge" title={t('custom order')}>#{index + 1}</span>
                    <button
                      type="button"
                      className="lane-move-btn"
                      aria-label={tp('move {name} up', { name: lane.workflow.name })}
                      onClick={() => moveLane(lane.workflow.id, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="lane-move-btn"
                      aria-label={tp('move {name} down', { name: lane.workflow.name })}
                      onClick={() => moveLane(lane.workflow.id, +1)}
                    >
                      ↓
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={lanes.length}
                      value={index + 1}
                      className="lane-position-input"
                      aria-label={tp('position of {name}', { name: lane.workflow.name })}
                      title={t('type a position to move the lane there')}
                      onChange={(event) => {
                        const pos = Number(event.target.value);
                        if (pos >= 1 && pos <= lanes.length) setLanePosition(lane.workflow.id, pos);
                      }}
                    />
                  </span>
                ) : null}
                <i className={`tone-dot ${lane.summary.tone}`} aria-hidden="true" />
                <span className="run-text">{lane.summary.text}</span>
              </span>
            </header>
            {collapsedLanes.includes(lane.workflow.id) ? null : (
            <div className="lane-track">
              {lane.steps.map((step, index) => (
                <Fragment key={`${step.stageIndex}:${step.source}`}>
                  {index > 0 ? <span className="lane-connector" aria-hidden="true">→</span> : null}
                  <StepCard
                    lane={step}
                    repository={lane.workflow.repository}
                    onOpen={() => setDrawerStage({ flowId: lane.workflow.id, stageIndex: step.stageIndex })}
                  />
                </Fragment>
              ))}
            </div>
            )}
          </article>
        )) : error ? null : (
          <article className="board-empty">
            <h3>{workflows.length ? t('No flows match this filter') : t('No flows yet — create one from a repository')}</h3>
            {workflows.length ? (
              <button type="button" className="ghost" onClick={() => setFilter('all')}>{t('Show all flows')}</button>
            ) : null}
          </article>
        )}
      </section>
      {repairTarget ? (
        <CodexRepairModal
          workflowId={repairTarget.flowId}
          stageIndex={repairTarget.stageIndex}
          source={repairTarget.source}
          onClose={() => setRepairTarget(null)}
        />
      ) : null}
      {auditOpen ? <FlowAuditModal onClose={() => setAuditOpen(false)} /> : null}
      {teamsOpen ? <TeamsModal onClose={() => setTeamsOpen(false)} /> : null}
      {preflightFlowId ? (
        <FlowPreflightModal
          flowId={preflightFlowId}
          flowName={state.workflows.find((workflow) => workflow.id === preflightFlowId)?.name ?? ''}
          onClose={() => setPreflightFlowId(null)}
        />
      ) : null}
    </div>
  );
}
