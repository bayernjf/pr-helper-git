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
  blockedAutomationForStep,
  buildLaneModels,
  configurationWarningsFor,
  configurationWarningText,
  flowPullUrl,
  stageStaleness,
  stageStateFor,
  type BoardFilter,
  type BoardState,
  type RunRow,
  type TimelineRow,
} from '../lib/automation/flows-board';
import { useToast, useConfirm } from './ui';
import { formatRelative } from '../lib/format';
import { runStateLabel, t, tp } from '../i18n';
import { saveWorkflowToServer } from '../api/flows';
import CodexRepairModal from './CodexRepairModal';
import FailureCenter from './FailureCenter';
import FlowEditor from './FlowEditor';
import { createWorkflow, moveWorkflowToPosition, sortWorkflowsForView, type Workflow } from '../lib/automation/workflow';
import { markResolved, pruneResolvedMarks, resolvedBoardState, type ResolvedMarks } from '../lib/automation/resolved-automation';
import FlowDetail from './FlowDetail';
import FlowAuditModal from './FlowAuditModal';
import FlowPreflightModal from './FlowPreflightModal';
import BoardPreflightModal from './BoardPreflightModal';
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

/** Compact timestamp in the board's local-time stamp style. */
function formatStamp(value?: string | null): string {
  return value ? value.slice(0, 16).replace('T', ' ') : '';
}

function StepCard({ lane, repository, onOpen, automationBlocked, stale, updatedAt }: {
  lane: ReturnType<typeof buildLaneModels>[number]['steps'][number];
  repository: string;
  onOpen: () => void;
  automationBlocked?: boolean;
  stale?: boolean;
  updatedAt?: string | null;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={`lane-step ${lane.tone}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <span className="step-index">{lane.stageIndex + 1}</span>
      <span className="step-main">
        <span className="step-route">
          <b>{lane.source}</b>
          <span className="step-arrow" aria-hidden="true">→</span>
          <b>{lane.target}</b>
          {automationBlocked ? <span className="lane-automation-badge">{t('automation blocked')}</span> : null}
          {stale ? <span className="lane-stale-badge">{t('stale')}</span> : null}
        </span>
        <span className="step-status">
          {lane.label}
          {lane.pullNumber ? (
            <PullReference
              url={flowPullUrl(repository, lane.pullNumber)}
              label={`#${lane.pullNumber}`}
            />
          ) : null}
        </span>
      </span>
      <span className="step-side">
        {updatedAt ? <time dateTime={updatedAt}>{formatRelative(updatedAt)}</time> : null}
        <span className="step-chevron" aria-hidden="true">›</span>
      </span>
    </div>
  );
}

/**
 * Run history + compact timeline for one lane. Old lane.ts renders both only
 * when the lane has matching rows, so a workflow with no history must not leave
 * two empty disclosure bars under an expanded lane.
 */
function LaneDetails({ flow, runs, timeline }: {
  flow: Workflow;
  runs: readonly RunRow[];
  timeline: readonly TimelineRow[];
}) {
  const laneRuns = runs.filter((run) => run.workflowId === flow.id).slice(0, 5);
  const laneTimeline = timeline.filter((row) => row.workflowId === flow.id).slice(0, 8);
  if (!laneRuns.length && !laneTimeline.length) return null;
  return (
    <div className="lane-details">
      {laneRuns.length ? (
        <details className="lane-history">
          <summary>{t('Run history')}</summary>
          <ol>
            {laneRuns.map((run, runIndex) => (
              <li key={run.id ?? runIndex} className={run.state ?? 'active'}>
                <span className="lane-detail-main">
                  <b>{run.source ?? '—'} → {run.target ?? '—'}</b>
                  <small>
                    {runStateLabel(run.state)}{run.version ? ` · v${run.version}` : ''}
                    {run.pullNumber ? (
                      <> · <PullReference url={flowPullUrl(flow.repository, run.pullNumber)} label={`#${run.pullNumber}`} /></>
                    ) : null}
                  </small>
                </span>
                <time>{formatStamp(run.completedAt ?? run.startedAt)}</time>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      {laneTimeline.length ? (
        <details className="lane-timeline">
          <summary>{t('Timeline')}</summary>
          <ol>
            {laneTimeline.map((row, rowIndex) => (
              <li key={row.runId ?? rowIndex} className={row.kind ?? ''}>
                <span className="lane-detail-main">
                  <b>{row.message ?? row.kind ?? '—'}</b>
                  {(row.source || row.target || row.pullNumber) ? (
                    <small>
                      {row.source ?? '—'} → {row.target ?? '—'}
                      {row.pullNumber ? (
                        <> · <PullReference url={flowPullUrl(flow.repository, row.pullNumber)} label={`#${row.pullNumber}`} /></>
                      ) : null}
                    </small>
                  ) : null}
                </span>
                <time>{formatStamp(row.occurredAt)}</time>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </div>
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
  const [expandedLanes, setExpandedLanes] = useState<string[]>([]);
  const [returnHighlight, setReturnHighlight] = useState<string | null>(null);
  const [drawerStage, setDrawerStage] = useState<{ flowId: string; stageIndex: number } | null>(null);
  const [repairTarget, setRepairTarget] = useState<{ flowId: string; stageIndex: number; source: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingFlowId, setEditingFlowId] = useState<string | null>(null);
  const [dragFlowId, setDragFlowId] = useState<string | null>(null);
  const [dragOverFlowId, setDragOverFlowId] = useState<string | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [teamsOpen, setTeamsOpen] = useState(false);
  const [preflightFlowId, setPreflightFlowId] = useState<string | null>(null);
  const [boardPreflightOpen, setBoardPreflightOpen] = useState(false);
  const [sortMode, setSortMode] = useState<'custom' | 'name' | 'createdAt'>('custom');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  /** Local resolve marks: handled steps stay hidden until the projection catches up. */
  const [resolvedMarks, setResolvedMarks] = useState<ResolvedMarks>(new Map());
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
    syncHealth: inbox?.syncHealth ?? null,
    configurationWarnings: inbox?.configurationWarnings ?? [],
    runs: inbox?.runs ?? [],
    timeline: inbox?.timeline ?? [],
  }), [inbox, workflows]);

  // Resolve marks hide handled work from the board view only; the drawer and
  // detail page keep the raw projection. Prune on every read so marks die
  // once the server catches up (the old background reconcile loop).
  useEffect(() => {
    setResolvedMarks((marks) => pruneResolvedMarks(marks, state));
  }, [state]);
  const boardState = useMemo(() => resolvedBoardState(state, resolvedMarks), [state, resolvedMarks]);
  const markStepResolved = useCallback((flowId: string, stageIndex: number, source: string) => {
    setResolvedMarks((marks) => markResolved(marks, state.automationActions, flowId, stageIndex, source));
  }, [state.automationActions]);

  const counts = useMemo(() => boardCounts(boardState), [boardState]);
  const lanes = useMemo(
    () => buildLaneModels(boardState, filter, search, sortMode, sortDirection),
    [boardState, filter, search, sortMode, sortDirection],
  );
  const allVisibleExpanded = lanes.length > 0 && lanes.every((lane) => expandedLanes.includes(lane.workflow.id));
  const canReorder = sortMode === 'custom' && filter === 'all' && !search;
  const editingFlow = editingFlowId ? workflows.find((workflow) => workflow.id === editingFlowId) : null;
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

  if (editingFlow) {
    return (
      <FlowEditor
        workflow={editingFlow}
        state={state}
        inbox={inbox ?? undefined}
        onClose={() => setEditingFlowId(null)}
        onSaved={(saved) => {
          setWorkflows((current) => (current.some((workflow) => workflow.id === saved.id)
            ? current.map((workflow) => (workflow.id === saved.id ? saved : workflow))
            : [...current, saved]));
          setEditingFlowId(null);
          setReturnHighlight(saved.id);
          void load(false);
        }}
      />
    );
  }

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
          onRefresh={() => void load(true, true)}
          refreshing={refreshing}
          onMutated={() => void load(true)}
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
            onResolved={(stageIndex, source) => markStepResolved(drawerStage.flowId, stageIndex, source)}
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
        <button type="button" className="drawer-btn" onClick={() => setBoardPreflightOpen(true)}>
          {t('Preflight all flows')}
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
          state={boardState}
          onOpenDrawer={(flowId, stageIndex) => setDrawerStage({ flowId, stageIndex })}
          onMutated={() => void load(true)}
          onResolved={markStepResolved}
          onRepair={(item) => setRepairTarget({ flowId: item.workflowId, stageIndex: item.stageIndex, source: item.source })}
          onTakeover={(item) => setDrawerStage({ flowId: item.workflowId, stageIndex: item.stageIndex })}
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
        <div className="board-summary-top">
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
          <button
            type="button"
            className="board-expand-all"
            disabled={!lanes.length}
            onClick={() => {
              const visibleIds = lanes.map((lane) => lane.workflow.id);
              setExpandedLanes((current) => (allVisibleExpanded
                ? current.filter((id) => !visibleIds.includes(id))
                : [...new Set([...current, ...visibleIds])]));
            }}
          >
            {allVisibleExpanded ? t('Collapse all') : t('Expand all')}
          </button>
        </div>
        <div className="board-filters">
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
        </div>
      </section>

      <section className="project-board">
        {lanes.length ? lanes.map((lane, index) => (
          <article
            key={lane.workflow.id}
            className={`project-lane${lane.workflow.archived ? ' is-archived' : ''}${returnHighlight === lane.workflow.id ? ' is-return-highlight' : ''}${expandedLanes.includes(lane.workflow.id) ? ' is-expanded' : ' is-collapsed'}${dragFlowId === lane.workflow.id ? ' is-dragging' : ''}${dragOverFlowId === lane.workflow.id && dragFlowId !== lane.workflow.id ? ' is-drop-target' : ''}`}
            onDragOver={canReorder ? (event) => {
              if (!dragFlowId || dragFlowId === lane.workflow.id) return;
              event.preventDefault();
              setDragOverFlowId(lane.workflow.id);
            } : undefined}
            onDragLeave={canReorder ? (event) => {
              if (event.currentTarget === event.target) setDragOverFlowId(null);
            } : undefined}
            onDrop={canReorder ? (event) => {
              event.preventDefault();
              if (!dragFlowId || dragFlowId === lane.workflow.id) {
                setDragFlowId(null);
                setDragOverFlowId(null);
                return;
              }
              const to = state.workflows.findIndex((workflow) => workflow.id === lane.workflow.id);
              if (to >= 0) moveLaneTo(dragFlowId, to);
              setDragFlowId(null);
              setDragOverFlowId(null);
            } : undefined}
          >
            <header className="lane-header">
              <button
                type="button"
                className="lane-drag-handle"
                draggable={canReorder}
                disabled={!canReorder}
                aria-label={canReorder ? tp('reorder {name}', { name: lane.workflow.name }) : undefined}
                title={canReorder ? t('Drag to reorder') : undefined}
                onDragStart={(event) => {
                  if (!canReorder) return;
                  setDragFlowId(lane.workflow.id);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', lane.workflow.id);
                }}
                onDragEnd={() => {
                  setDragFlowId(null);
                  setDragOverFlowId(null);
                }}
              >
                <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                  <circle cx="5" cy="4" r="1.35" />
                  <circle cx="11" cy="4" r="1.35" />
                  <circle cx="5" cy="8" r="1.35" />
                  <circle cx="11" cy="8" r="1.35" />
                  <circle cx="5" cy="12" r="1.35" />
                  <circle cx="11" cy="12" r="1.35" />
                </svg>
              </button>
              <button
                type="button"
                className="lane-title-block"
                onClick={() => setSelectedFlowId(lane.workflow.id)}
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
                  {lane.workflow.team?.name ? <span className="lane-badge">{lane.workflow.team.name}</span> : null}
                </h2>
              </button>
              <div className="lane-actions">
                <button
                  type="button"
                  className="drawer-btn small"
                  onClick={() => setEditingFlowId(lane.workflow.id)}
                >
                  {t('Edit')}
                </button>
                <button
                  type="button"
                  className="drawer-btn small"
                  onClick={() => setSelectedFlowId(lane.workflow.id)}
                >
                  {t('View')}
                </button>
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
              <div className="lane-run">
                <i className={`tone-dot ${lane.summary.tone}`} aria-hidden="true" />
                <span className="run-text">{lane.summary.text}</span>
              </div>
              <div className="lane-controls">
                {canReorder ? (
                  <span className="lane-move">
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
                      onChange={(event) => {
                        const pos = Number(event.target.value);
                        if (pos >= 1 && pos <= lanes.length) setLanePosition(lane.workflow.id, pos);
                      }}
                    />
                  </span>
                ) : null}
                <button
                  type="button"
                  className="lane-move-btn lane-collapse-btn"
                  aria-expanded={expandedLanes.includes(lane.workflow.id)}
                  aria-label={expandedLanes.includes(lane.workflow.id) ? t('Collapse') : t('Expand')}
                  onClick={() => setExpandedLanes((current) => (current.includes(lane.workflow.id)
                    ? current.filter((id) => id !== lane.workflow.id)
                    : [...current, lane.workflow.id]))}
                >
                  {expandedLanes.includes(lane.workflow.id) ? '–' : '+'}
                </button>
              </div>
            </header>
            {expandedLanes.includes(lane.workflow.id) && configurationWarningsFor(state, lane.workflow.id).length ? (
              <div className="lane-config-warning">
                <span className="lane-config-warning-count">
                  {configurationWarningsFor(state, lane.workflow.id).length === 1
                    ? t('1 warning')
                    : tp('{count} warnings', { count: configurationWarningsFor(state, lane.workflow.id).length })}
                </span>
                <span
                  className="lane-config-warning-item"
                  title={configurationWarningsFor(state, lane.workflow.id).map(configurationWarningText).join('\n')}
                >
                  {configurationWarningText(configurationWarningsFor(state, lane.workflow.id)[0])}
                  {configurationWarningsFor(state, lane.workflow.id).length > 1
                    ? ` +${configurationWarningsFor(state, lane.workflow.id).length - 1}`
                    : ''}
                </span>
              </div>
            ) : null}
            {!expandedLanes.includes(lane.workflow.id) ? null : (
            <div className={`lane-track${lane.mergeGroups ? ' has-fan-in' : ''}`}>
              {lane.mergeGroups ? lane.mergeGroups.map((group) => (
                <section key={group.target} className="lane-merge-group">
                  <p>{tp('Merging into {target}', { target: group.target })}</p>
                  <div>
                    {group.steps.map((step) => (
                      <StepCard
                        key={`${step.stageIndex}:${step.source}`}
                        lane={step}
                        repository={lane.workflow.repository}
                        automationBlocked={Boolean(blockedAutomationForStep(boardState.automationActions, lane.workflow.id, step.stageIndex))}
                        stale={stageStaleness(state, lane.workflow.id, step.stageIndex).stale}
                        updatedAt={stageStateFor(state, lane.workflow.id, step.stageIndex, step.source)?.updatedAt}
                        onOpen={() => setDrawerStage({ flowId: lane.workflow.id, stageIndex: step.stageIndex })}
                      />
                    ))}
                  </div>
                </section>
              )) : lane.steps.map((step, index) => (
                <Fragment key={`${step.stageIndex}:${step.source}`}>
                  {index > 0 ? <span className="lane-connector" aria-hidden="true">→</span> : null}
                  <StepCard
                    lane={step}
                    repository={lane.workflow.repository}
                    automationBlocked={Boolean(blockedAutomationForStep(boardState.automationActions, lane.workflow.id, step.stageIndex))}
                    stale={stageStaleness(state, lane.workflow.id, step.stageIndex).stale}
                    updatedAt={stageStateFor(state, lane.workflow.id, step.stageIndex, step.source)?.updatedAt}
                    onOpen={() => setDrawerStage({ flowId: lane.workflow.id, stageIndex: step.stageIndex })}
                  />
                </Fragment>
              ))}
            </div>
            )}
            <LaneDetails
              flow={lane.workflow}
              runs={inbox?.runs ?? []}
              timeline={inbox?.timeline ?? []}
            />
          </article>
        )) : error ? null : (
          <article className="board-empty">
            <h3>{workflows.length ? t('No flows match this filter') : t('No flows yet — create one from a repository')}</h3>
            {workflows.length ? (
              <button type="button" className="ghost" onClick={() => { setFilter('all'); setSearch(''); }}>
                {search ? t('Clear search') : t('Show all flows')}
              </button>
            ) : null}
          </article>
        )}
      </section>
      {drawerStage && inbox ? (
        <StepDrawer
          flow={state.workflows.find((workflow) => workflow.id === drawerStage.flowId)!}
          stageIndex={drawerStage.stageIndex}
          inbox={inbox}
          onClose={() => setDrawerStage(null)}
          onMutated={() => void load(true)}
          onResolved={(stageIndex, source) => markStepResolved(drawerStage.flowId, stageIndex, source)}
        />
      ) : null}
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
      {boardPreflightOpen ? (
        <BoardPreflightModal workflows={state.workflows} onClose={() => setBoardPreflightOpen(false)} />
      ) : null}
    </div>
  );
}
