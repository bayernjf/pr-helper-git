// Step drawer (Phase 3, P3-3 + P3-10): per-step operations — create PR / merge
// / rerun / AI takeover — over the automation actions on one stage route, plus
// the stage's event stream and deployment gates (managed-repository Actions
// runs, health, failure summary, retry and confirmed rollback). Operations
// ride the write routes landed in server/flows.mjs and fail loudly until P2-1
// provides the credentials.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEscape } from '../hooks/use-escape';
import CodexRepairModal from './CodexRepairModal';
import { useToast, useConfirm } from './ui';
import { errorMessage } from '../lib/errors';
import { stageStateText } from '../lib/automation/flows-detail';
import { deploymentConfigs, matchingStageProjections, type DeploymentConfig, type Workflow } from '../lib/automation/workflow';
import { automationActionPresentation, type AutomationActionState } from '../lib/automation/workflow-run';
import { githubPullUrl } from '../lib/domain';
import PullReference from './PullReference';
import {
  enqueueAutomation,
  executeAutomationAction,
  regenerateAutomationMessage,
  rerunFailedActions,
  retryDeploymentRun,
  rollbackDeployment,
  takeoverAutomationAction,
  type DeploymentRow,
  type DeploymentRunRow,
  type DeploymentConfigurationWarningRow,
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

const DEPLOYMENT_STATE_LABEL: Record<string, string> = {
  pending: 'waiting for the deployment run',
  success: 'deployed',
  failure: 'deployment failed',
};

function providerName(provider: DeploymentConfig['provider']): string {
  return provider === 'vercel' ? 'Vercel' : 'Cloudflare Pages';
}

function deploymentTone(state: string): string {
  return state === 'success' ? 'success' : state === 'failure' ? 'failure' : 'pending';
}

function deploymentWarningText(warning: DeploymentConfigurationWarningRow): string {
  switch (warning.code) {
    case 'no-deployments':
      return t('No deployment gates configured for this flow');
    case 'actions-unavailable':
      return t('Could not read GitHub Actions workflows');
    case 'workflow-not-found':
      return tp('Deployment workflow not found: {value}', { value: warning.value ?? '' });
    case 'environment-missing':
      return t('GitHub Environment is empty');
    case 'environment-not-found':
      return tp('GitHub Environment not found: {value}', { value: warning.value ?? '' });
    case 'health-path-invalid':
      return t('Health check path does not start with /');
    case 'rollback-workflow-not-found':
      return tp('Rollback workflow not found: {value}', { value: warning.value ?? '' });
    default:
      return warning.code;
  }
}

export default function StepDrawer({ flow, stageIndex, inbox, onClose, onMutated }: {
  flow: Workflow;
  stageIndex: number;
  inbox: InboxPayload;
  onClose: () => void;
  /** Called after a successful operation so the board can re-read the projection. */
  onMutated: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const drawerRef = useRef<HTMLDivElement>(null);

  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    drawerRef.current?.focus();
    return () => previousFocus.current?.focus();
  }, []);
  const [busy, setBusy] = useState<string>('');
  const [error, setError] = useState('');
  const [takeoverFor, setTakeoverFor] = useState<number | null>(null);
  const [repairOpen, setRepairOpen] = useState(false);
  // Takeover form has its own Escape layer: first Esc cancels the form
  // (keeping the drawer and the typed text), only then does the drawer close.
  useEscape(onClose, takeoverFor === null);
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

  const deploymentRows = useMemo(
    () => inbox.deployments.filter(
      (deployment) => deployment.workflowId === flow.id
        && (stage.stageId ? deployment.stageId === stage.stageId : deployment.stageIndex === stageIndex)
        && (!primary ? true : deployment.source === primary.source),
    ),
    [inbox.deployments, flow.id, stage.stageId, stageIndex, primary],
  );
  const deploymentHistory = useMemo(
    () => inbox.deploymentRuns.filter(
      (run) => run.workflowId === flow.id
        && (stage.stageId ? run.stageId === stage.stageId : run.stageIndex === stageIndex)
        && (!primary ? true : run.source === primary.source),
    ).slice(0, 8),
    [inbox.deploymentRuns, flow.id, stage.stageId, stageIndex, primary],
  );
  const deploymentWarnings = useMemo(
    () => inbox.configurationWarnings.filter(
      (warning) => warning.workflowId === flow.id
        && (!warning.target || warning.target === stage.target),
    ),
    [inbox.configurationWarnings, flow.id, stage.target],
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

  function deploymentConfigFor(provider: DeploymentConfig['provider']) {
    return deploymentConfigs(flow).find((configuration) => configuration.target === stage.target && configuration.provider === provider);
  }

  function retryDeployment(row: DeploymentRow) {
    if (!row.runId) {
      toast.error(t('This deployment has no run to retry'));
      return;
    }
    void runOp(`retry-deployment-${row.provider}-${row.runId}`, () => retryDeploymentRun({
      workflowId: flow.id,
      stageIndex,
      source: row.source || primary?.source || stage.source,
      provider: row.provider,
      runId: row.runId!,
    }), t('Deployment retry requested'));
  }

  async function rollbackDeploymentRun(run: DeploymentRunRow) {
    if (!run.runId) return;
    const configuration = deploymentConfigFor(run.provider);
    if (!configuration?.rollbackWorkflowName) {
      toast.error(t('This deployment gate has no rollback workflow configured'));
      return;
    }
    const confirmed = await confirm({
      title: tp('Roll back {provider} {environment}?', {
        provider: providerName(run.provider),
        environment: t(run.environment === 'production' ? 'production' : 'preview'),
      }),
      detail: tp('Target: {repository} · {source} → {target}\nRun #{runId} · workflow: {workflow}\nThis dispatches the managed repository’s rollback workflow. The run identity cannot be rewritten.', {
        repository: flow.repository,
        source: run.source,
        target: stage.target,
        runId: run.runId,
        workflow: configuration.rollbackWorkflowName,
      }),
      confirmLabel: t('Roll back'),
      danger: true,
    });
    if (!confirmed) return;
    void runOp(`rollback-${run.provider}-${run.runId}`, () => rollbackDeployment({
      workflowId: flow.id,
      stageIndex,
      source: run.source || primary?.source || stage.source,
      provider: run.provider,
      runId: run.runId!,
    }), t('Deployment rollback started'));
  }

  return (
    <div className="drawer-backdrop" onClick={onClose} role="presentation">
      <aside
        ref={drawerRef}
        tabIndex={-1}
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
            <PullReference url={githubPullUrl(flow.repository, pullNumber)} label={`#${pullNumber}`} />
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
              {busy === 'create-pr' ? t('Queuing…') : t('create PR')}
            </button>
          ) : null}
          {primary?.pullState === 'open' ? (
            <button
              type="button"
              className="drawer-btn primary"
              disabled={busy !== ''}
              onClick={() => enqueue('merge-pr')}
            >
              {busy === 'merge-pr' ? t('Queuing…') : t('merge PR')}
            </button>
          ) : null}
          <button
            type="button"
            className="drawer-btn"
            disabled={busy !== ''}
            onClick={rerun}
          >
            {busy === 'rerun' ? t('Rerunning…') : t('rerun Actions')}
          </button>
          <button
            type="button"
            className="drawer-btn"
            onClick={() => setRepairOpen(true)}
          >
            {t('Codex repair context')}
          </button>
        </div>

        {deploymentWarnings.length ? (
          <div className="drawer-section drawer-deployment-warnings">
            <span className="drawer-label">{t('Deployment configuration warnings')}</span>
            <ul>
              {deploymentWarnings.map((warning, index) => <li key={index}>{deploymentWarningText(warning)}</li>)}
            </ul>
          </div>
        ) : null}

        {deploymentRows.length ? (
          <div className="drawer-section drawer-deployments">
            <span className="drawer-label">{t('Deployment gates')}</span>
            <div className="deployment-cards">
              {deploymentRows.map((deployment) => {
                const tone = deploymentTone(deployment.state);
                const primaryUrl = deployment.deploymentUrl || deployment.runUrl;
                return (
                  <article key={`${deployment.provider}-${deployment.source}`} className={`deployment-card ${tone}`}>
                    <div className="deployment-card-main">
                      <b>{providerName(deployment.provider)}</b>
                      <small>
                        {t(deployment.environment === 'production' ? 'production' : 'preview')}
                        {' · '}
                        {deployment.runId === null ? t('configured workflow has no run yet') : t(DEPLOYMENT_STATE_LABEL[deployment.state] ?? deployment.state)}
                      </small>
                      {deployment.healthState ? (
                        <small className={`deployment-health ${deployment.healthState}`}>
                          {t('health check')} · {deployment.healthState === 'success' ? t('passed') : t('failed')}
                          {deployment.healthDetail ? ` (${deployment.healthDetail})` : ''}
                        </small>
                      ) : null}
                      {deployment.failureSummary ? <p className="deployment-failure-summary">{deployment.failureSummary}</p> : null}
                    </div>
                    <div className="deployment-card-actions">
                      {deployment.state === 'failure' && deployment.runId ? (
                        <button
                          type="button"
                          className="drawer-btn small"
                          disabled={busy !== ''}
                          onClick={() => retryDeployment(deployment)}
                        >
                          {busy === `retry-deployment-${deployment.provider}-${deployment.runId}` ? t('Retrying…') : t('retry deployment')}
                        </button>
                      ) : null}
                      {deployment.failureJobUrl ? <a href={deployment.failureJobUrl} target="_blank" rel="noreferrer">{t('failed job')} ↗</a> : null}
                      {deployment.deploymentUrl ? <a href={deployment.deploymentUrl} target="_blank" rel="noreferrer">{t('open site')} ↗</a> : null}
                      {deployment.runUrl ? <a href={deployment.runUrl} target="_blank" rel="noreferrer">{t('open logs')} ↗</a> : null}
                      {primaryUrl && !deployment.deploymentUrl && !deployment.runUrl ? <a href={primaryUrl} target="_blank" rel="noreferrer">{t('open')} ↗</a> : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        ) : null}

        {deploymentHistory.length ? (
          <div className="drawer-section drawer-deployment-history">
            <span className="drawer-label">{t('Recent deployment runs')}</span>
            <ol>
              {deploymentHistory.map((run) => {
                const configuration = deploymentConfigFor(run.provider);
                const canRollback = run.state === 'success' && Boolean(run.deploymentUrl) && Boolean(configuration?.rollbackWorkflowName);
                return (
                  <li key={`${run.provider}-${run.runId}`} className={run.state}>
                    <div>
                      <b>{providerName(run.provider)} · {t(run.environment === 'production' ? 'production' : 'preview')}</b>
                      <small>
                        {run.runId === null ? t('run unavailable') : `#${run.runId}`}
                        {' · '}
                        {t(DEPLOYMENT_STATE_LABEL[run.state] ?? run.state)}
                        {run.healthState ? ` · ${t('health check')} ${run.healthState === 'success' ? t('passed') : t('failed')}` : ''}
                      </small>
                    </div>
                    <div className="deployment-run-actions">
                      {canRollback ? (
                        <button
                          type="button"
                          className="drawer-btn small"
                          disabled={busy !== ''}
                          onClick={() => void rollbackDeploymentRun(run)}
                        >
                          {busy === `rollback-${run.provider}-${run.runId}` ? t('Starting…') : t('roll back')}
                        </button>
                      ) : null}
                      {run.runUrl ? <a href={run.runUrl} target="_blank" rel="noreferrer">{t('logs')} ↗</a> : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        ) : null}

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
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              event.stopPropagation();
                              setTakeoverFor(null);
                            }
                          }}
                        />
                        <textarea
                          value={takeoverBody}
                          onChange={(event) => setTakeoverBody(event.target.value)}
                          placeholder={t('takeover body (PR description)')}
                          aria-label={t('takeover body (PR description)')}
                          rows={4}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              event.stopPropagation();
                              setTakeoverFor(null);
                            }
                          }}
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
        {repairOpen ? (
        <CodexRepairModal
          workflowId={flow.id}
          stageIndex={stageIndex}
          source={primary?.source || stage.source}
          pullNumber={pullNumber}
          onClose={() => setRepairOpen(false)}
        />
      ) : null}
    </aside>
    </div>
  );
}
