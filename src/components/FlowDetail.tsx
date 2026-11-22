// Flow detail (Phase 3, P3-2): read-only detail page behind a board lane —
// progress bar, per-stage timeline with projected statuses and events, and
// the stage's automation flags. Operations (create/merge/repair) arrive with
// the step drawer (P3-3); live revalidation arrives with P2-1 credentials.
import { useEffect, useMemo, useState } from 'react';
import { useToast, useConfirm } from './ui';
import {
  deleteFlowFromServer,
  enqueueAutomation,
  fetchAiCredential,
  fetchGenerationRules,
  rerunFailedActions,
  saveWorkflowToServer,
  type AiAutomationCredential,
  type GenerationRuleRow,
} from '../api/flows';
import {
  buildStageDetails,
  flowProgress,
  nextActionSummary,
  type NextActionKind,
  type StageDetailModel,
  type StageEventRow,
} from '../lib/automation/flows-detail';
import { automationActionPresentation, type StageProgressStatus } from '../lib/automation/workflow-run';
import {
  immediateAutomationEffect,
  setStageAutoAdvance,
  setStageAutoCreate,
  setStageAutoMerge,
  workflowSummary,
} from '../lib/automation/workflow';
import { automationPrerequisiteCodes } from '../lib/automation/editor-prerequisites';
import { canMergeOpenPull, githubPullUrl } from '../lib/domain';
import { errorMessage } from '../lib/errors';
import { formatRelative } from '../lib/format';
import type { BoardState } from '../lib/automation/flows-board';
import { getLocale, runStateLabel, t, tp } from '../i18n';
import FlowEditor from './FlowEditor';
import FlowCreatePrModal from './FlowCreatePrModal';
import PullReference from './PullReference';
import GateDisclosure from './GateDisclosure';
import StageActionsGate from './StageActionsGate';
import CodexRepairModal from './CodexRepairModal';
import { usePreferences } from '../app-state/preferences-provider';
import { useCheckDetails } from '../hooks/use-check-details';
import { useSourceBranchMissing } from '../hooks/use-source-branch-missing';
import { IconRefresh } from './icons';

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

const ACTION_KIND_TEXT: Record<string, string> = {
  'create-pr': 'auto-create PR',
  'merge-pr': 'auto-merge PR',
  'advance-stage': 'auto-advance stage',
};

function latestStageAction(
  inbox: import('../api/flows').InboxPayload | undefined,
  flowId: string,
  stageIndex: number,
  stageId: string | undefined,
) {
  if (!inbox) return undefined;
  return inbox.automation
    .filter((action) => action.workflowId === flowId
      && (stageId ? action.stageId === stageId : action.stageIndex === stageIndex))
    .sort((left, right) => String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')))[0];
}

/** Compare the pinned rule with the same-named library rule; the server API has no default flag. */
function pinnedRuleUpdate(
  stored: { name: string; content?: string; contentHash?: string } | undefined,
  rules: GenerationRuleRow[],
): { name: string; content: string } | undefined {
  if (!stored?.content?.trim()) return undefined;
  const current = rules.find((rule) => rule.name === stored.name);
  if (!current || current.content === stored.content) return undefined;
  return { name: current.name, content: current.content };
}

/** "M/D HH:mm" in local time, matching the board's updated stamp. */
function formatEventTime(occurredAt: string): string {
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(getLocale() === 'zh' ? 'zh-CN' : 'en-US', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

function AutomationToggle({ label, enabled, disabled, busy, title, onClick }: {
  label: string;
  enabled: boolean;
  disabled: boolean;
  busy: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`detail-auto-toggle${enabled ? ' is-on' : ''}`}
      aria-pressed={enabled}
      disabled={disabled || busy}
      data-tip={title}
      onClick={onClick}
    >
      <span className="detail-auto-box" aria-hidden="true">{enabled ? '✓' : ''}</span>
      <span>{busy ? t('Saving…') : label}</span>
    </button>
  );
}

/** Check gate chip that expands into live check details, like the old detail page. */
function StageSourceBranchHint({ repository, source }: { repository: string; source: string }) {
  const { pat, hasServerPat } = usePreferences();
  const missing = useSourceBranchMissing(pat, hasServerPat, repository, source);
  if (!missing) return null;
  return <p className="detail-branch-missing">{t('status.sourceBranchDeletedHint')}</p>;
}

function StageChecksGate({ summary, repository, headSha, target }: {
  summary: string;
  repository: string;
  headSha: string | null;
  target: string;
}) {
  const { pat, hasServerPat } = usePreferences();
  const details = useCheckDetails(pat, hasServerPat, repository, headSha);
  return (
    <GateDisclosure
      summary={summary}
      details={details}
      target={target}
      className="detail-gate detail-check-gate"
    />
  );
}

export default function FlowDetail({ flowId, state, events, inbox, onClose, onOpenDrawer, onRefresh, refreshing = false, onMutated, onSaved, onDeleted }: {
  flowId: string;
  state: BoardState;
  events: readonly StageEventRow[];
  inbox?: import('../api/flows').InboxPayload;
  onClose: () => void;
  /** Opens the step drawer for one stage (P3-3 operations); a concrete route wins on dynamic stages. */
  onOpenDrawer?: (stageIndex: number, source?: string) => void;
  /** Reconciles the persisted projection with GitHub from the detail page. */
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Refresh the board snapshot after an inline stage operation. */
  onMutated?: () => void;
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
  const [busyAction, setBusyAction] = useState('');
  const [createPrStage, setCreatePrStage] = useState<StageDetailModel | null>(null);
  const [actionError, setActionError] = useState('');
  const [repairTarget, setRepairTarget] = useState<{ stageIndex: number; source: string; pullNumber: number | null } | null>(null);
  const editable = Boolean(onSaved);
  const [ai, setAi] = useState<AiAutomationCredential>(null);
  const [rules, setRules] = useState<GenerationRuleRow[]>([]);
  const automationReady = useMemo(() => automationPrerequisiteCodes({
    projectionAvailable: Boolean(inbox),
    credentialConfigured: Boolean(ai?.configured),
    autoGeneratePrMessage: Boolean(ai?.autoGeneratePrMessage),
    autoConfirmPrCreation: Boolean(ai?.autoConfirmPrCreation),
    generationRuleCount: rules.length,
  }).length === 0, [inbox, ai, rules]);
  useEffect(() => {
    if (!editable) return undefined;
    let cancelled = false;
    fetchAiCredential()
      .then((res) => { if (!cancelled) setAi(res.credential); })
      .catch(() => { if (!cancelled) setAi(null); });
    fetchGenerationRules()
      .then((res) => { if (!cancelled) setRules(res.rules); })
      .catch(() => { if (!cancelled) setRules([]); });
    return () => { cancelled = true; };
  }, [editable]);
  const stages = useMemo(
    () => (flow ? buildStageDetails(state, flow, events) : []),
    [state, flow, events],
  );
  const progress = useMemo(() => (flow ? flowProgress(state, flow) : null), [state, flow]);
  const progressPercent = progress?.total ? Math.round((progress.completed / progress.total) * 100) : 0;
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

  const flowForActions = flow;

  async function queueStageAction(stage: (typeof stages)[number], kind: 'create-pr' | 'merge-pr') {
    const key = `${stage.index}:${kind}`;
    setBusyAction(key);
    setActionError('');
    try {
      await enqueueAutomation({
        workflowId: flowForActions.id,
        stageIndex: stage.index,
        source: stage.source,
        kind,
        idempotencyKey: `detail-${flowForActions.id}-${stage.index}-${kind}-${Date.now()}`,
      });
      toast.notify(t(kind === 'create-pr' ? 'create PR queued' : 'merge queued'));
      onMutated?.();
    } catch (err) {
      const message = errorMessage(err);
      setActionError(message);
      toast.error(message);
    } finally {
      setBusyAction('');
    }
  }

  async function rerunStageActions(stage: (typeof stages)[number]) {
    const key = `${stage.index}:rerun`;
    setBusyAction(key);
    setActionError('');
    try {
      await rerunFailedActions({ workflowId: flowForActions.id, stageIndex: stage.index, source: stage.source });
      toast.notify(t('Actions rerun requested'));
      onMutated?.();
    } catch (err) {
      const message = errorMessage(err);
      setActionError(message);
      toast.error(message);
    } finally {
      setBusyAction('');
    }
  }

  /**
   * Inline automation toggles from the old detail page: flip the switch and
   * persist the whole workflow. Enabling auto-create pins the first library
   * rule (or the rule already pinned on the stage), matching the editor's
   * create path; all mutations go through the ported pure helpers.
   */
  async function toggleStageAutomation(stage: (typeof stages)[number], toggle: 'create' | 'merge' | 'advance') {
    if (!onSaved || !automationReady || busyAction) return;
    const key = `${stage.index}:automation`;
    const enabling = toggle === 'create'
      ? !stage.automation.autoCreate
      : toggle === 'merge' ? !stage.automation.autoMerge : !stage.automation.autoAdvance;
    const currentStage = flowForActions.stages[stage.index];
    const effect = immediateAutomationEffect({
      toggle: toggle === 'advance' ? 'merge' : toggle,
      enabling,
      stage: { source: stage.source, target: stage.target },
      status: {
        kind: stage.kind,
        aheadBy: stage.aheadBy,
        pr: stage.pullNumber ? { number: stage.pullNumber } : null,
      },
      unlocked: true,
      triggerMinCommits: currentStage?.automation?.triggerMinCommits,
    });
    const effectCopy = effect.kind === 'merge-pr'
      ? tp('Enabling auto-merge will merge PR #{number} immediately once gates pass.', { number: effect.pullNumber })
      : effect.kind === 'create-pr'
        ? tp('Enabling auto-create will create the PR immediately ({count} new commits).', { count: effect.aheadBy })
        : null;
    if (effectCopy) {
      const confirmed = await confirm({
        title: t('Automation immediate effect'),
        detail: `${effectCopy}\n\n${t('Continue?')}`,
      });
      if (!confirmed) return;
    }

    let rule: { name: string; content: string } | undefined;
    if (toggle === 'create' && enabling) {
      const pinned = currentStage?.automation?.generationRule;
      if (pinned?.content) {
        rule = { name: pinned.name, content: pinned.content };
      } else if (rules[0]) {
        rule = { name: rules[0].label || rules[0].name, content: rules[0].content };
      }
      if (!rule) {
        toast.error(t('no generation rules in the library — add one to pr_helper_generation_rules first'));
        return;
      }
    }

    const next = toggle === 'create'
      ? setStageAutoCreate(flowForActions, stage.index, enabling, rule, currentStage?.automation?.triggerMinCommits || 1)
      : toggle === 'merge'
        ? setStageAutoMerge(flowForActions, stage.index, enabling)
        : setStageAutoAdvance(flowForActions, stage.index, enabling);
    setBusyAction(key);
    setActionError('');
    try {
      const saved = await saveWorkflowToServer(next);
      toast.notify(t('Workflow saved'));
      onSaved(saved);
      onMutated?.();
    } catch (err) {
      const message = errorMessage(err);
      setActionError(message);
      toast.error(message);
    } finally {
      setBusyAction('');
    }
  }

  /** Threshold is an editable number on the old detail page, not just a read-only label. */
  async function saveStageThreshold(stage: (typeof stages)[number], raw: string, input: HTMLInputElement) {
    if (!onSaved || !automationReady || busyAction) return;
    const currentStage = flowForActions.stages[stage.index];
    const pinned = currentStage?.automation?.generationRule;
    const rule = pinned?.content
      ? { name: pinned.name, content: pinned.content }
      : rules[0] ? { name: rules[0].label || rules[0].name, content: rules[0].content } : undefined;
    const fallback = String(currentStage?.automation?.triggerMinCommits || 1);
    if (!currentStage?.automation?.autoCreatePullRequest || !rule) {
      input.value = fallback;
      return;
    }
    const threshold = Number(raw);
    if (!Number.isInteger(threshold) || threshold < 1) {
      input.value = fallback;
      toast.error(t('The commit threshold must be a positive integer.'));
      return;
    }
    const bounded = Math.min(20, threshold);
    input.value = String(bounded);
    if (bounded === (currentStage.automation.triggerMinCommits || 1)) return;
    setBusyAction(`${stage.index}:threshold`);
    setActionError('');
    try {
      const saved = await saveWorkflowToServer(
        setStageAutoCreate(flowForActions, stage.index, true, rule, bounded),
      );
      toast.notify(tp('Auto-create trigger threshold updated to {count} commits.', { count: bounded }));
      onSaved(saved);
      onMutated?.();
    } catch (err) {
      const message = errorMessage(err);
      setActionError(message);
      toast.error(message);
      input.value = fallback;
    } finally {
      setBusyAction('');
    }
  }

  /** Re-pin the latest content of the same-named library rule (the server API has no default flag). */
  async function syncStageRule(stage: (typeof stages)[number], update: { name: string; content: string }) {
    if (!onSaved || busyAction) return;
    const currentStage = flowForActions.stages[stage.index];
    if (!currentStage) return;
    setBusyAction(`${stage.index}:rule`);
    setActionError('');
    try {
      const saved = await saveWorkflowToServer(
        setStageAutoCreate(flowForActions, stage.index, true, update, currentStage.automation?.triggerMinCommits || 1),
      );
      toast.notify(tp('This step now uses the generation rule “{name}”.', { name: update.name }));
      onSaved(saved);
      onMutated?.();
    } catch (err) {
      const message = errorMessage(err);
      setActionError(message);
      toast.error(message);
    } finally {
      setBusyAction('');
    }
  }
  const summary = workflowSummary(flow);
  const headline = !progress?.synced
    ? t('Waiting for status sync')
    : progress.currentIndex === null
      ? progress.total === 1
        ? t('All done · 1 step, waiting for new commits')
        : tp('All done · {total} steps, waiting for new commits', { total: progress.total })
      : tp('Step {step} of {total} · {completed} completed', {
        step: progress.currentIndex + 1,
        total: progress.total,
        completed: progress.completed,
      });

  return (
    <div className="flow-detail-page">
      <div className="detail-topbar">
        <button type="button" className="ghost detail-back" onClick={onClose}>← {t('Back')}</button>
        <div className="detail-topbar-actions">
          {onRefresh ? (
            <button
              type="button"
              className="drawer-btn detail-refresh"
              onClick={onRefresh}
              disabled={refreshing}
              aria-busy={refreshing}
            >
              <IconRefresh width={14} height={14} />
              {refreshing ? t('Refreshing…') : t('Refresh status')}
            </button>
          ) : null}
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
        </div>
      </div>

      <section className="detail-hero">
        <div className="detail-head-main">
          {flow.name.toLocaleLowerCase() !== flow.repository.toLocaleLowerCase() ? (
            <p className="detail-eyebrow">{flow.repository}</p>
          ) : null}
          <h1>{flow.name}</h1>
          <p className="detail-route">{summary.route}</p>
        </div>
        <span className={`detail-sync-chip${progress?.synced ? ' is-synced' : ''}`}>
          <i className={`tone-dot ${progress?.synced ? 'succeeded' : 'idle'}`} aria-hidden="true" />
          {t(progress?.synced ? 'Flow status synced' : 'Waiting for status sync')}
        </span>
      </section>

      {actionError ? <div className="compact-notice is-error detail-action-error"><p>{actionError}</p></div> : null}

      <div className="detail-layout">
        <main className="detail-main">
          <section className="detail-progress flow-progress">
            <div className="flow-progress-head">
              <span className="detail-progress-label">{t('Flow progress')}</span>
              <span className="flow-progress-headline">{headline}</span>
            </div>
            <div className="flow-progress-bar" aria-hidden="true">
              <span style={{ width: `${progressPercent}%` }} />
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

          <section className="detail-stages">
            {stages.map((stage) => {
              const checkGate = stage.checksTotal && stage.gates.length ? stage.gates[0] : null;
              const otherGates = checkGate ? stage.gates.slice(1) : stage.gates;
              const canMerge = stage.kind === 'open' && canMergeOpenPull({
                checks: stage.checksState ?? undefined,
                approvalsMet: stage.requiredApprovals === 0 || stage.approvals >= stage.requiredApprovals,
                mergeable: stage.mergeable,
                mergeableState: stage.mergeableState ?? undefined,
              });
              const stageAction = latestStageAction(inbox, flow.id, stage.index, flow.stages[stage.index]?.stageId);
              const actionPresentation = stageAction ? automationActionPresentation(stageAction) : null;
              const ruleUpdate = pinnedRuleUpdate(flow.stages[stage.index]?.automation?.generationRule, rules);
              const busy = busyAction !== '';
              return (
                <article key={stage.index} className={`detail-stage ${stage.tone}`}>
                  <div className="detail-stage-head">
                    <span className="step-index">{stage.index + 1}</span>
                    <div className="detail-stage-route">
                      <b>{stage.source} → {stage.target}</b>
                      <StageSourceBranchHint repository={flow.repository} source={stage.source} />
                      {stage.pullNumber ? (
                        <PullReference
                          url={stage.pullUrl ?? githubPullUrl(flow.repository, stage.pullNumber)}
                          label={`#${stage.pullNumber}`}
                        />
                      ) : null}
                    </div>
                    <span className={`detail-state-chip ${stage.tone}`}>
                      <i className={`tone-dot ${stage.tone}`} aria-hidden="true" />
                      {stage.stateText}
                    </span>
                  </div>

                  {(checkGate || otherGates.length || stage.headSha) ? (
                    <div className="detail-gates">
                      {checkGate ? (
                        <StageChecksGate
                          summary={checkGate}
                          repository={flow.repository}
                          headSha={stage.headSha}
                          target={stage.target}
                        />
                      ) : null}
                      {stage.headSha ? (
                        <StageActionsGate
                          className="detail-gate detail-actions-gate"
                          repository={flow.repository}
                          headSha={stage.headSha}
                          target={stage.target}
                        />
                      ) : null}
                      {otherGates.map((gate, gateIndex) => <span key={gateIndex} className="detail-gate">{gate}</span>)}
                    </div>
                  ) : null}

                  {!stage.dynamic ? (
                    <div className="detail-stage-actions">
                      {stage.pullUrl ? (
                        <a className="drawer-btn small" href={stage.pullUrl} target="_blank" rel="noreferrer">
                          {t('Open PR')}
                        </a>
                      ) : null}
                      {(stage.kind === 'not-created' || stage.kind === 'merged') && stage.aheadBy > 0 ? (
                        <button
                          type="button"
                          className="drawer-btn small primary"
                          disabled={busy}
                          onClick={() => setCreatePrStage(stage)}
                        >
                          {busyAction === `${stage.index}:create-pr` ? t('Queuing…') : t('create PR')}
                        </button>
                      ) : null}
                      {stage.kind === 'open' ? (
                        <button
                          type="button"
                          className="drawer-btn small"
                          disabled={busy || !canMerge}
                          title={!canMerge ? t('GitHub gates not met') : undefined}
                          onClick={() => void queueStageAction(stage, 'merge-pr')}
                        >
                          {busyAction === `${stage.index}:merge-pr` ? t('Queuing…') : t('merge PR')}
                        </button>
                      ) : null}
                      {stage.checksState === 'failure' ? (
                        <>
                          <button
                            type="button"
                            className="drawer-btn small"
                            disabled={busy}
                            onClick={() => void rerunStageActions(stage)}
                          >
                            {busyAction === `${stage.index}:rerun` ? t('Rerunning…') : t('rerun Actions')}
                          </button>
                          <button
                            type="button"
                            className="drawer-btn small"
                            disabled={busy}
                            onClick={() => setRepairTarget({
                              stageIndex: stage.index,
                              source: stage.source,
                              pullNumber: stage.pullNumber,
                            })}
                          >
                            {t('Codex repair context')}
                          </button>
                        </>
                      ) : null}
                      {onOpenDrawer ? (
                        <button type="button" className="drawer-btn small" onClick={() => onOpenDrawer(stage.index)}>
                          {t('step details')}
                        </button>
                      ) : null}
                    </div>
                  ) : onOpenDrawer ? (
                    <div className="detail-stage-actions">
                      <button type="button" className="drawer-btn small" onClick={() => onOpenDrawer(stage.index)}>
                        {t('step details')}
                      </button>
                    </div>
                  ) : null}

                  {stage.dynamic ? (
                    <div className="detail-routes">
                      {stage.routes.map((route) => (
                        <button
                          key={route.source}
                          type="button"
                          className="detail-route-row"
                          onClick={() => onOpenDrawer?.(stage.index, route.source)}
                        >
                          <i className={`tone-dot ${route.tone}`} aria-hidden="true" />
                          <b>{route.source}</b>
                          <span>{route.label}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}

                  <div className="detail-automation">
                    <span className="detail-automation-label">{t('Automation')}</span>
                    <AutomationToggle
                      label={t('auto-create PR')}
                      enabled={stage.automation.autoCreate}
                      disabled={!editable || !automationReady}
                      busy={busyAction === `${stage.index}:automation`}
                      title={!editable || !automationReady ? t('Automation prerequisites unmet — automation toggles are disabled') : undefined}
                      onClick={() => void toggleStageAutomation(stage, 'create')}
                    />
                    <label
                      className="detail-threshold"
                      title={t('Number of new commits required to trigger automatic PR creation')}
                    >
                      <span>{t('Trigger after')}</span>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        step={1}
                        defaultValue={stage.automation.threshold}
                        disabled={!stage.automation.autoCreate || !editable || !automationReady || busyAction !== ''}
                        aria-label={t('Trigger after')}
                        onBlur={(event) => void saveStageThreshold(stage, event.currentTarget.value, event.currentTarget)}
                      />
                      <span>{t('new commits')}</span>
                    </label>
                    <AutomationToggle
                      label={t('auto-merge')}
                      enabled={stage.automation.autoMerge}
                      disabled={!editable || !automationReady}
                      busy={busyAction === `${stage.index}:automation`}
                      title={!editable || !automationReady ? t('Automation prerequisites unmet — automation toggles are disabled') : undefined}
                      onClick={() => void toggleStageAutomation(stage, 'merge')}
                    />
                    <AutomationToggle
                      label={t('auto-advance')}
                      enabled={stage.automation.autoAdvance}
                      disabled={!editable || !automationReady || (!stage.automation.autoCreate && !stage.automation.autoMerge)}
                      busy={busyAction === `${stage.index}:automation`}
                      title={!editable || !automationReady
                        ? t('Automation prerequisites unmet — automation toggles are disabled')
                        : (!stage.automation.autoCreate && !stage.automation.autoMerge) ? t('Auto-advance needs auto-create or auto-merge on the same step') : undefined}
                      onClick={() => void toggleStageAutomation(stage, 'advance')}
                    />
                    {stageAction && actionPresentation ? (
                      <div className={`detail-automation-status is-${actionPresentation.tone}`}>
                        <b>{t(stageAction.kind ? ACTION_KIND_TEXT[stageAction.kind] || stageAction.kind : 'Automation')}</b>
                        <span>{t(stageAction.state)}</span>
                        {stageAction.attempts ? <span>· {tp('{count} attempts', { count: stageAction.attempts })}</span> : null}
                        {stageAction.failureReason ? <small>{stageAction.failureReason}</small> : null}
                        {stageAction.updatedAt ? <time>{formatRelative(stageAction.updatedAt)}</time> : null}
                      </div>
                    ) : null}
                  </div>

                  {ruleUpdate && stage.automation.autoCreate ? (
                    <div className="detail-rule-outdated">
                      <span>{tp('The default generation rule “{name}” was updated; this step still generates from the older version.', { name: ruleUpdate.name })}</span>
                      <button
                        type="button"
                        className="drawer-btn small"
                        disabled={!editable || busyAction !== ''}
                        onClick={() => void syncStageRule(stage, ruleUpdate)}
                      >
                        {t('Sync')}
                      </button>
                    </div>
                  ) : null}

                  {stage.events.length ? (
                    <details className="detail-events" open={stage.tone === 'failed'}>
                      <summary className="detail-events-summary">
                        <span className="detail-events-label">{t('Stage events')}</span>
                        <span className="detail-events-count">{tp('{count} items', { count: stage.events.length })}</span>
                      </summary>
                      <ol>
                        {stage.events.map((event, eventIndex) => (
                          <li key={eventIndex}>
                            <span>{event.message}</span>
                            <time>{formatEventTime(event.occurredAt)}</time>
                          </li>
                        ))}
                      </ol>
                    </details>
                  ) : (
                    <div className="detail-events detail-events-empty">
                      <span className="detail-events-label">{t('Stage events')}</span>
                      <p className="detail-no-events">{t('No events yet')}</p>
                    </div>
                  )}
                </article>
              );
            })}
          </section>
        </main>

        <aside className="detail-side">
          <section className={`detail-next-action is-${nextAction}`}>
            <p className="detail-eyebrow">{t('Next action')}</p>
            <h2>{t(NEXT_ACTION_TEXT[nextAction])}</h2>
            {progress?.next?.reason ? <p className="detail-next-reason">{progress.next.reason}</p> : null}
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
                    <span>{runStateLabel(run.state)}{run.version ? ` · v${run.version}` : ''}</span>
                    <time>{formatEventTime(run.completedAt ?? run.startedAt ?? '')}</time>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          <section className="detail-facts">
            <span className="detail-events-label">{t('Flow facts')}</span>
            <dl>
              <div>
                <dt>{t('Repository')}</dt>
                <dd>{flow.repository}</dd>
              </div>
              <div>
                <dt>{t('Steps')}</dt>
                <dd>{flow.stages.length}</dd>
              </div>
              {flow.team?.name ? (
                <div>
                  <dt>{t('Team')}</dt>
                  <dd>{flow.team.name}</dd>
                </div>
              ) : null}
              <div>
                <dt>{t('Updated')}</dt>
                <dd>{progress?.syncedAt ? formatRelative(progress.syncedAt) : '—'}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>

      {createPrStage ? (
        <FlowCreatePrModal
          repository={flow.repository}
          source={createPrStage.source}
          target={createPrStage.target}
          onClose={() => setCreatePrStage(null)}
          onCreated={() => { setCreatePrStage(null); onMutated?.(); }}
        />
      ) : null}

      {repairTarget ? (
        <CodexRepairModal
          workflowId={flow.id}
          stageIndex={repairTarget.stageIndex}
          source={repairTarget.source}
          pullNumber={repairTarget.pullNumber}
          onClose={() => setRepairTarget(null)}
        />
      ) : null}
    </div>
  );
}
