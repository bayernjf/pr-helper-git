// Flow editor (Phase 3, P3-4 + P3-7; P3-10/P3-11): edits an existing flow's
// identity, step routes, automation toggles, deployment gates, recovery
// policy and repository binding. The automation mutations use the ported
// pure helpers (setStageAutoCreate/AutoMerge/AutoAdvance) and the toggle
// confirmation mirrors the original confirmImmediateAutomation interaction:
// flipping a switch computes the immediate effect on the persisted projection
// and asks before it saves.
//
// Repository changes intentionally leave the existing flow untouched: a flow
// is bound to one repository, so switching turns the draft into a new flow
// (the original confirmRepositorySwitch semantics).
import { useEffect, useMemo, useState } from 'react';
import { useToast } from './ui';
import { errorMessage } from '../lib/errors';
import {
  setStageAutoCreate,
  setStageAutoMerge,
  setStageAutoAdvance,
  addStage,
  removeStage,
  reorderStages,
  addDeployment,
  removeDeployment,
  replaceDeployment,
  createWorkflow,
  deploymentConfigs,
  deploymentConfigurationWarnings,
  deploymentSuggestions,
  syncedDeployments,
  type DeploymentConfig,
  type DeploymentConfigurationWarning,
  type Workflow,
} from '../lib/automation/workflow';
import { immediateAutomationEffect } from '../lib/automation/workflow';
import { projectedStageStatus } from '../lib/automation/projected-stage';
import { matchingStageProjections } from '../lib/automation/workflow';
import { automationPrerequisiteCodes, type AutomationPrerequisiteCode } from '../lib/automation/editor-prerequisites';
import {
  fetchDeploymentOptions,
  saveWorkflowToServer,
  deleteAiCredential,
  fetchAiCredential,
  fetchGenerationRules,
  saveAiCredential,
  testSavedAiCredential,
  type AiAutomationCredential,
  type DeploymentOptions,
  type GenerationRuleRow,
} from '../api/flows';
import type { BoardState } from '../lib/automation/flows-board';
import { t, tp } from '../i18n';

type EditorStage = Workflow['stages'][number];

/** Stable key for the per-stage collapse state; stageId survives reorders. */
function stageKey(stage: EditorStage, index: number): string {
  return stage.stageId ?? `index:${index}`;
}

/**
 * The four prerequisites upstream requires before automation toggles may be
 * flipped: server AI credential, auto-generate, auto-confirm and at least one
 * generation rule. The local build mirrors the original disable behaviour
 * instead of merely warning.
 */
function automationPrerequisites(
  inbox?: { readWarnings?: Array<{ source: string; message: string }> } | null,
  ai?: AiAutomationCredential | null,
  rules: GenerationRuleRow[] = [],
): { ok: boolean; missing: string[] } {
  const labels: Record<AutomationPrerequisiteCode, string> = {
    projection: t('projection unavailable'),
    credential: t('server AI credential not configured'),
    'auto-generate': t('auto-generate PR message is off'),
    'auto-confirm': t('auto-confirm PR creation is off'),
    rules: t('no generation rules in the library'),
  };
  const codes = automationPrerequisiteCodes({
    projectionAvailable: Boolean(inbox),
    credentialConfigured: Boolean(ai?.configured),
    autoGeneratePrMessage: Boolean(ai?.autoGeneratePrMessage),
    autoConfirmPrCreation: Boolean(ai?.autoConfirmPrCreation),
    generationRuleCount: rules.length,
  });
  return { ok: codes.length === 0, missing: codes.map((code) => labels[code]) };
}

/** Immediate effect confirmation copy, mirroring the original dialog. */
function effectText(effect: ReturnType<typeof immediateAutomationEffect>): string | null {
  if (effect.kind === 'none') return null;
  if (effect.kind === 'merge-pr') {
    return tp('Enabling auto-merge will merge PR #{number} immediately once gates pass.', { number: effect.pullNumber });
  }
  return tp('Enabling auto-create will create the PR immediately ({count} new commits).', { count: effect.aheadBy });
}

/** Deployment warning copy. The codes come from the ported pure validator. */
function deploymentWarningText(warning: DeploymentConfigurationWarning): string {
  switch (warning.code) {
    case 'no-deployments':
      return t('No deployment gates — the deployment gate is not holding this stage');
    case 'actions-unavailable':
      return t('Could not read GitHub Actions workflows — existing gates are kept as configured');
    case 'workflow-not-found':
      return tp('Workflow not found in this repository: {value}', { value: warning.value ?? '' });
    case 'environment-missing':
      return t('GitHub Environment is empty — leave it blank only when the repository has none');
    case 'environment-not-found':
      return tp('GitHub Environment not found in this repository: {value}', { value: warning.value ?? '' });
    case 'health-path-invalid':
      return t('Health check path must start with /');
    case 'rollback-workflow-not-found':
      return tp('Rollback workflow not found in this repository: {value}', { value: warning.value ?? '' });
    default:
      return warning.code;
  }
}

function deploymentProviderName(provider: DeploymentConfig['provider']): string {
  return provider === 'vercel' ? 'Vercel' : 'Cloudflare Pages';
}

function defaultDeploymentFor(workflow: Workflow): DeploymentConfig {
  const target = workflow.stages[workflow.stages.length - 1]?.target || 'main';
  const existing = deploymentConfigs(workflow).filter((deployment) => deployment.target === target);
  const provider: DeploymentConfig['provider'] = existing.some((deployment) => deployment.provider === 'vercel') ? 'cloudflare' : 'vercel';
  return {
    target,
    provider,
    workflowName: provider === 'vercel' ? 'Deploy frontend to Vercel' : 'Deploy frontend to Cloudflare Pages',
    environment: target === 'main' ? 'production' : 'preview',
  };
}

export default function FlowEditor({ workflow, initialDraft, state, inbox, onClose, onSaved }: {
  /** Existing flow to edit; omit for create mode with initialDraft pre-seeded. */
  workflow?: Workflow;
  initialDraft?: Workflow;
  state: BoardState;
  inbox?: import('../api/flows').InboxPayload;
  onClose: () => void;
  onSaved: (saved: Workflow) => void;
}) {
  const toast = useToast();
  const initial = useMemo(
    () => structuredClone(workflow ?? initialDraft ?? createWorkflow('', 'dev', 'main')),
    // The caller supplies one stable draft for the lifetime of the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [draft, setDraft] = useState<Workflow>(initial);
  const [createMode, setCreateMode] = useState(workflow === undefined);
  // Existing flows open with every step form folded; a new flow keeps its
  // first step open so the user can start typing immediately (#5/#6).
  const [expandedStages, setExpandedStages] = useState<Set<string>>(() => new Set(
    workflow ? [] : initial.stages.map((stage, index) => stageKey(stage, index)),
  ));
  const [repositoryInput, setRepositoryInput] = useState(initial.repository);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [options, setOptions] = useState<DeploymentOptions | null>(null);
  const [optionsError, setOptionsError] = useState('');
  const [deploymentFormOpen, setDeploymentFormOpen] = useState(false);
  const [deploymentEditIndex, setDeploymentEditIndex] = useState<number | null>(null);
  const [deploymentDraft, setDeploymentDraft] = useState<DeploymentConfig | null>(null);
  const [removedDeployment, setRemovedDeployment] = useState<{ deployment: DeploymentConfig; index: number } | null>(null);
  const [ai, setAi] = useState<AiAutomationCredential>(null);
  const [rules, setRules] = useState<GenerationRuleRow[]>([]);
  const prerequisites = useMemo(() => automationPrerequisites(inbox, ai, rules), [inbox, ai, rules]);

  useEffect(() => {
    if (!/^[^/\s]+\/[^/\s]+$/.test(draft.repository)) {
      setOptions(null);
      setOptionsError('');
      return undefined;
    }
    let cancelled = false;
    fetchDeploymentOptions(draft.repository)
      .then((next) => {
        if (cancelled) return;
        setOptions(next);
        setOptionsError('');
      })
      .catch((err) => {
        if (cancelled) return;
        setOptions(null);
        setOptionsError(errorMessage(err));
      });
    return () => { cancelled = true; };
  }, [draft.repository]);

  useEffect(() => {
    fetchAiCredential().then((res) => setAi(res.credential)).catch(() => setAi(null));
    fetchGenerationRules().then((res) => setRules(res.rules)).catch(() => setRules([]));
  }, []);


  function patchStage(stageIndex: number, patch: (stage: EditorStage) => EditorStage) {
    setDraft((current) => ({
      ...current,
      stages: current.stages.map((stage, index) => (index === stageIndex ? patch(stage) : stage)),
    }));
  }

  const [aiForm, setAiForm] = useState({
    baseUrl: '',
    model: '',
    apiKey: '',
    autoGeneratePrMessage: true,
    autoConfirmPrCreation: true,
  });

  // Prefill the form from the saved credential (key stays masked server side).
  useEffect(() => {
    if (ai?.configured) {
      setAiForm((current) => ({
        ...current,
        baseUrl: ai.baseUrl ?? current.baseUrl,
        model: ai.model ?? current.model,
        autoGeneratePrMessage: ai.autoGeneratePrMessage ?? current.autoGeneratePrMessage,
        autoConfirmPrCreation: ai.autoConfirmPrCreation ?? current.autoConfirmPrCreation,
      }));
    }
  }, [ai]);

  async function saveAi() {
    setSaving(true);
    setError('');
    try {
      const res = await saveAiCredential({
        baseUrl: aiForm.baseUrl.trim(),
        model: aiForm.model.trim(),
        apiKey: aiForm.apiKey.trim(),
        autoGeneratePrMessage: aiForm.autoGeneratePrMessage,
        autoConfirmPrCreation: aiForm.autoConfirmPrCreation,
      });
      setAi(res.credential);
      setAiForm((current) => ({ ...current, apiKey: '' }));
      toast.notify(t('AI credential saved'));
    } catch (err) {
      const message = errorMessage(err);
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function testAi() {
    setSaving(true);
    setError('');
    try {
      const res = await testSavedAiCredential();
      toast.notify(`${t('AI credential test ok')} · ${res.model ?? ''}`);
    } catch (err) {
      const message = errorMessage(err);
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function removeAi() {
    setSaving(true);
    setError('');
    try {
      await deleteAiCredential();
      setAi(null);
      toast.notify(t('AI credential deleted'));
    } catch (err) {
      const message = errorMessage(err);
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleAutomation(stageIndex: number, toggle: 'create' | 'merge' | 'advance', enabling: boolean) {
    const stage = draft.stages[stageIndex];
    const projection = matchingStageProjections(draft, stageIndex, state.states)[0];
    const status = projection ? projectedStageStatus({
      repository: draft.repository,
      pullState: projection.pullState ?? '',
      checksState: projection.checksState ?? '',
      pullNumber: projection.pullNumber ?? null,
      headSha: null,
      mergedAt: null,
      checksPassed: projection.checksPassed ?? 0,
      checksTotal: projection.checksTotal ?? 0,
      approvals: 0,
      requiredApprovals: 0,
      mergeable: null,
      mergeableState: null,
    }) : null;

    // P3-7: 勾选即动作确认 — compute what enabling would do right now and
    // ask before it happens.
    const effect = immediateAutomationEffect({
      toggle: toggle === 'advance' ? 'merge' : toggle,
      enabling,
      stage: { source: stage.source, target: stage.target },
      status: status ? { kind: status.kind, aheadBy: status.aheadBy, pr: status.pr ?? null } : null,
      unlocked: true,
      triggerMinCommits: stage.automation?.triggerMinCommits,
    });
    const effectCopy = effectText(effect);
    if (effectCopy) {
      // eslint-disable-next-line no-alert
      const confirmed = window.confirm(`${effectCopy}\n\n${t('Continue?')}`);
      if (!confirmed) return;
    }

    // Automation composition goes through the ported pure helpers, which
    // build the literal-union shapes correctly. Upstream pins a generation
    // rule (name+content) on enable — the editor offers the migrated rule
    // library; without a library entry the toggle is refused (the pure
    // helper also refuses, mirroring upstream). Enabling auto-create also
    // requires the AI credential (M-E5): the message draft comes from it.
    let rule: { name: string; content: string } | undefined;
    if (toggle === 'create' && enabling) {
      const pinned = stage.automation?.generationRule;
      if (pinned?.content) {
        rule = { name: pinned.name, content: pinned.content };
      } else if (rules.length) {
        const picked = window.prompt(
          `${t('pick a generation rule for this step')}\n\n${rules.map((r, i) => `${i + 1}. ${r.label}`).join('\n')}\n\n${t('enter the number, or leave empty to cancel')}`,
          '1',
        );
        const index = Number(picked) - 1;
        if (!picked || Number.isNaN(index) || !rules[index]) return;
        rule = { name: rules[index].label, content: rules[index].content };
      } else {
        toast.error(t('no generation rules in the library — add one to pr_helper_generation_rules first'));
        return;
      }
      if (!ai?.configured) {
        toast.error(t('AI credential not configured — auto-create needs it to draft the PR message'));
        return;
      }
    }
    setDraft((current) => {
      if (toggle === 'create') {
        return setStageAutoCreate(current, stageIndex, enabling, rule, stage.automation?.triggerMinCommits || 1);
      }
      if (toggle === 'merge') return setStageAutoMerge(current, stageIndex, enabling);
      return setStageAutoAdvance(current, stageIndex, enabling);
    });
  }

  const deploymentWarnings = useMemo(
    () => deploymentConfigurationWarnings(draft, {
      actionsLoaded: options?.actionsAvailable ?? false,
      actionWorkflows: options?.workflows ?? [],
      environmentsLoaded: options?.environmentsAvailable ?? false,
      environments: options?.environments ?? [],
    }),
    [draft, options],
  );
  const configuredDeployments = useMemo(() => deploymentConfigs(draft), [draft]);
  const deploymentTargets = useMemo(
    () => [...new Set([...draft.stages.map((stage) => stage.target), ...configuredDeployments.map((deployment) => deployment.target)])],
    [draft.stages, configuredDeployments],
  );
  const suggestions = useMemo(
    () => (options?.actionsAvailable ? deploymentSuggestions(draft, options.workflows, options.environments) : []),
    [draft, options],
  );
  const generalDeploymentWarnings = deploymentWarnings.filter((warning) => warning.deploymentIndex === undefined);
  const rowDeploymentWarnings = (index: number) => deploymentWarnings.filter((warning) => warning.deploymentIndex === index);

  function openAddDeployment() {
    setDeploymentEditIndex(null);
    setDeploymentDraft(defaultDeploymentFor(draft));
    setDeploymentFormOpen(true);
  }

  function openEditDeployment(index: number) {
    setDeploymentEditIndex(index);
    setDeploymentDraft({ ...configuredDeployments[index] });
    setDeploymentFormOpen(true);
  }

  function updateDeploymentDraft(patch: Partial<DeploymentConfig>) {
    setDeploymentDraft((current) => ({ ...(current ?? defaultDeploymentFor(draft)), ...patch }));
  }

  function submitDeployment() {
    if (!deploymentDraft) return;
    const deployment: DeploymentConfig = {
      ...deploymentDraft,
      workflowName: deploymentDraft.workflowName.trim(),
      githubEnvironment: deploymentDraft.githubEnvironment?.trim() || undefined,
      healthCheckPath: deploymentDraft.healthCheckPath?.trim() || undefined,
      rollbackWorkflowName: deploymentDraft.rollbackWorkflowName?.trim() || undefined,
    };
    if (!deployment.workflowName) {
      toast.error(t('Deployment workflow name is required'));
      return;
    }
    if (deployment.healthCheckPath && !deployment.healthCheckPath.startsWith('/')) {
      toast.error(t('Health check path must start with /'));
      return;
    }
    if (configuredDeployments.some((current, index) => index !== deploymentEditIndex && current.target === deployment.target && current.provider === deployment.provider)) {
      toast.error(t('This target and provider already have a deployment gate'));
      return;
    }
    setDraft((current) => (deploymentEditIndex === null
      ? addDeployment(current, deployment)
      : replaceDeployment(current, deploymentEditIndex, deployment)));
    setDeploymentFormOpen(false);
    setDeploymentEditIndex(null);
    setDeploymentDraft(null);
    setRemovedDeployment(null);
    toast.notify(t(deploymentEditIndex === null ? 'Deployment gate added' : 'Deployment gate updated'));
  }

  function removeDeploymentAt(index: number) {
    const removed = configuredDeployments[index];
    setDraft((current) => removeDeployment(current, index));
    setRemovedDeployment(removed ? { deployment: removed, index } : null);
    setDeploymentFormOpen(false);
    setDeploymentEditIndex(null);
    setDeploymentDraft(null);
    toast.notify(t('Deployment gate removed'));
  }

  function undoRemoveDeployment() {
    if (!removedDeployment) return;
    const { deployment, index } = removedDeployment;
    setDraft((current) => {
      const deployments = [...deploymentConfigs(current)];
      deployments.splice(Math.min(index, deployments.length), 0, deployment);
      return { ...current, deployments };
    });
    setRemovedDeployment(null);
    toast.notify(t('Deployment gate restored'));
  }

  function syncDeployments() {
    if (!options?.actionsAvailable) {
      toast.error(t('Cannot sync deployment gates while GitHub Actions workflows are unavailable'));
      return;
    }
    const next = syncedDeployments(draft, options.workflows, options.environments, true);
    setDraft((current) => ({ ...current, deployments: next }));
    toast.notify(t('Deployment gates synced to the repository workflows'));
  }

  function applySuggestion(index: number) {
    const suggestion = suggestions[index];
    if (!suggestion) return;
    setDeploymentEditIndex(null);
    setDeploymentDraft(suggestion);
    setDeploymentFormOpen(true);
  }

  function switchRepository() {
    const repository = repositoryInput.trim();
    if (repository === draft.repository) return;
    if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) {
      toast.error(t('Repository must be owner/repo'));
      return;
    }
    // A flow is bound to one repository. Replacing it in place would silently
    // move the original flow's history onto another repository, so the
    // original stays untouched and the draft becomes a new flow.
    // eslint-disable-next-line no-alert
    const confirmed = window.confirm(tp('Change this flow to {repository}? A new flow will be created; the original flow stays unchanged.', { repository }));
    if (!confirmed) return;
    const next = createWorkflow(repository, draft.stages[0]?.source || 'dev', draft.stages[0]?.target || 'main', draft.name || repository, []);
    setDraft(next);
    setCreateMode(true);
    setRepositoryInput(repository);
    setDeploymentFormOpen(false);
    setDeploymentDraft(null);
    toast.notify(t('New flow started for the new repository — the original flow was left unchanged'));
  }

  async function save() {
    if (!createMode && repositoryInput.trim() !== draft.repository) {
      toast.error(t('Confirm the repository change first'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const saved = await saveWorkflowToServer(draft);
      toast.notify(t('Workflow saved'));
      onSaved(saved);
      onClose();
    } catch (err) {
      const message = errorMessage(err);
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flow-editor-page">
      <section className="page-head editor-head">
        <button type="button" className="ghost" onClick={onClose}>← {t('Back')}</button>
        <div className="detail-head-main">
          <p className="detail-eyebrow">{draft.repository || t('New flow')}</p>
          <h1>{createMode ? t('New flow') : t('Edit flow')}</h1>
        </div>
        <button
          type="button"
          className="drawer-btn primary"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? t('Refreshing…') : t('Save')}
        </button>
      </section>

      {error ? <div className="drawer-error">{error}</div> : null}

      {!prerequisites.ok ? (
        <details className="compact-notice">
          <summary>{t('Automation prerequisites unmet — automation toggles are disabled')}</summary>
          {prerequisites.missing.map((item, index) => <p key={index}>{item}</p>)}
        </details>
      ) : null}

      <section className="editor-card">
        <label className="editor-label">
          {t('Flow name')}
          <input
            value={draft.name}
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          />
        </label>
        <label className="editor-label">
          {t('Repository')}
          <input
            value={createMode ? draft.repository : repositoryInput}
            placeholder={t('owner/repo')}
            onChange={(event) => {
              const value = event.target.value;
              setRepositoryInput(value);
              if (createMode) setDraft((current) => ({ ...current, repository: value }));
            }}
          />
        </label>
        {!createMode && repositoryInput.trim() !== draft.repository ? (
          <div className="compact-notice">
            <p>{t('A flow is bound to one repository. Changing it creates a new flow and leaves the original unchanged.')}</p>
            <button type="button" className="drawer-btn small" onClick={switchRepository}>
              {t('Change repository and create a new flow')}
            </button>
          </div>
        ) : null}
      </section>

      <section className="editor-card">
        <span className="drawer-label">{t('Steps')}</span>
        {draft.stages.map((stage, index) => {
          const key = stageKey(stage, index);
          const expanded = expandedStages.has(key);
          return (
          <article key={key} className={`editor-stage${expanded ? ' is-open' : ''}`}>
            <button
              type="button"
              className="editor-stage-head"
              aria-expanded={expanded}
              onClick={() => setExpandedStages((current) => {
                const next = new Set(current);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              })}
            >
              <span className="step-index">{index + 1}</span>
              <b>{stage.source} → {stage.target}</b>
              <span className="editor-stage-toggle">{t(expanded ? 'collapse' : 'expand')}</span>
            </button>
            {expanded ? (
            <div className="editor-stage-fields">
            <div className="editor-stage-body">
              <label>
                {t('source branch')}
                <input
                  value={stage.source}
                  disabled={stage.source.includes('*')}
                  onChange={(event) => patchStage(index, (current) => ({ ...current, source: event.target.value }))}
                />
              </label>
              <span className="editor-arrow">→</span>
              <label>
                {t('target branch')}
                <input
                  value={stage.target}
                  onChange={(event) => patchStage(index, (current) => ({ ...current, target: event.target.value }))}
                />
              </label>
            </div>
            <div className="editor-automation">
              <label className="editor-toggle">
                <input
                  type="checkbox"
                  checked={stage.automation?.autoCreatePullRequest === true}
                  disabled={!prerequisites.ok}
                  onChange={(event) => void toggleAutomation(index, 'create', event.target.checked)}
                />
                {t('auto-create')}
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={stage.automation?.triggerMinCommits || 1}
                  className="editor-threshold"
                  title={t('auto-create threshold')}
                  disabled={!prerequisites.ok || stage.automation?.autoCreatePullRequest !== true}
                  onChange={(event) => {
                    const threshold = Math.min(20, Math.max(1, Number(event.target.value) || 1));
                    const currentStage = draft.stages[index];
                    const rule = currentStage?.automation?.generationRule;
                    if (!rule?.content) {
                      toast.error(t('rule content not stored locally — automation editing needs the rule library (M-E)'));
                      return;
                    }
                    setDraft((current) => setStageAutoCreate(
                      current,
                      index,
                      current.stages[index]?.automation?.autoCreatePullRequest === true,
                      { name: rule.name, content: rule.content! },
                      threshold,
                    ));
                  }}
                />
              </label>
              <label className="editor-toggle">
                <input
                  type="checkbox"
                  checked={stage.automation?.autoMergePullRequest === true}
                  disabled={!prerequisites.ok}
                  onChange={(event) => void toggleAutomation(index, 'merge', event.target.checked)}
                />
                {t('auto-merge')}
              </label>
              <label className="editor-toggle">
                <input
                  type="checkbox"
                  checked={(stage.automation as { autoAdvanceNext?: true } | undefined)?.autoAdvanceNext === true}
                  disabled={!prerequisites.ok}
                  onChange={(event) => void toggleAutomation(index, 'advance', event.target.checked)}
                />
                {t('auto-advance')}
              </label>
              {draft.stages.length > 1 ? (
                <button
                  type="button"
                  className="drawer-btn small"
                  onClick={() => setDraft((current) => removeStage(current, index))}
                >
                  {t('remove step')}
                </button>
              ) : null}
            </div>
            {draft.stages.length > 1 ? (
              <div className="editor-stage-order">
                <span>{t('step order')}</span>
                <button
                  type="button"
                  className="drawer-btn small"
                  aria-label={t('move step up')}
                  title={t('move step up')}
                  disabled={index === 0}
                  onClick={() => setDraft((current) => reorderStages(current, index, index - 1))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="drawer-btn small"
                  aria-label={t('move step down')}
                  title={t('move step down')}
                  disabled={index === draft.stages.length - 1}
                  onClick={() => setDraft((current) => reorderStages(current, index, index + 1))}
                >
                  ↓
                </button>
              </div>
            ) : null}
            </div>
            ) : null}
          </article>
          );
        })}
        <button
          type="button"
          className="drawer-btn"
          onClick={() => {
            setDraft((current) => addStage(current, 'feature', current.stages[current.stages.length - 1]?.target || 'main'));
            // The upstream editor folds every step after adding a new one (#5).
            setExpandedStages(new Set());
          }}
        >
          {t('add step')}
        </button>
      </section>

      <section className="editor-card">
        <div className="editor-section-head">
          <span className="drawer-label">{t('Deployment gates')}</span>
          <button type="button" className="drawer-btn small" onClick={openAddDeployment}>
            {t('add deployment gate')}
          </button>
          <button
            type="button"
            className="drawer-btn small"
            disabled={!options?.actionsAvailable}
            title={options?.actionsAvailable ? t('Re-derive gates from the repository workflows') : t('Cannot sync while Actions workflows are unavailable')}
            onClick={syncDeployments}
          >
            {t('sync gates')}
          </button>
        </div>
        <p className="editor-hint">
          {t('Track the managed repository’s GitHub Actions deployments. The provider is only a label; pr-helper-git itself is not deployed to Vercel or Cloudflare.')}
        </p>
        {optionsError ? <p className="editor-hint error">{optionsError}</p> : null}
        {generalDeploymentWarnings.length ? (
          <ul className="deployment-config-warnings">
            {generalDeploymentWarnings.map((warning, index) => <li key={`general-${index}`}>{deploymentWarningText(warning)}</li>)}
          </ul>
        ) : null}
        {configuredDeployments.length ? (
          <div className="deployment-config-list">
            {configuredDeployments.map((deployment, index) => {
              const warnings = rowDeploymentWarnings(index);
              return (
                <article key={`${deployment.target}:${deployment.provider}:${index}`} className={`deployment-config-row${warnings.length ? ' has-warning' : ''}`}>
                  <div className="deployment-config-main">
                    <b>{deployment.target}</b>
                    <span className="deployment-chip">{deploymentProviderName(deployment.provider)}</span>
                    <span className={`deployment-chip env-${deployment.environment}`}>{t(deployment.environment === 'production' ? 'production' : 'preview')}</span>
                    <small>
                      {deployment.workflowName}
                      {deployment.githubEnvironment ? ` · ${deployment.githubEnvironment}` : ''}
                      {deployment.healthCheckPath ? ` · ♥ ${deployment.healthCheckPath}` : ''}
                    </small>
                    {deployment.rollbackWorkflowName ? <small>↩ {deployment.rollbackWorkflowName}</small> : null}
                  </div>
                  {warnings.length ? (
                    <ul className="deployment-row-warnings">
                      {warnings.map((warning, warningIndex) => <li key={warningIndex}>{deploymentWarningText(warning)}</li>)}
                    </ul>
                  ) : null}
                  <div className="deployment-row-actions">
                    <button type="button" className="drawer-btn small" onClick={() => openEditDeployment(index)}>{t('edit')}</button>
                    <button type="button" className="drawer-btn small" onClick={() => removeDeploymentAt(index)}>{t('remove')}</button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="drawer-empty">{t('No deployment gates configured')}</p>
        )}
        {removedDeployment ? (
          <div className="deployment-undo">
            <span>{tp('Removed {provider} · {target}', { provider: deploymentProviderName(removedDeployment.deployment.provider), target: removedDeployment.deployment.target })}</span>
            <button type="button" className="drawer-btn small" onClick={undoRemoveDeployment}>{t('undo')}</button>
          </div>
        ) : null}
        {suggestions.length ? (
          <div className="deployment-suggestions">
            <b>{t('Suggestions from this repository')}</b>
            {suggestions.map((suggestion, index) => (
              <div key={`${suggestion.target}:${suggestion.provider}:${index}`}>
                <small>{suggestion.target} · {deploymentProviderName(suggestion.provider)} · {suggestion.workflowName}</small>
                <button type="button" className="drawer-btn small" onClick={() => applySuggestion(index)}>{t('use')}</button>
              </div>
            ))}
          </div>
        ) : null}
        {deploymentFormOpen && deploymentDraft ? (
          <div className="deployment-add-form">
            <p className="editor-hint">{deploymentEditIndex === null ? t('New deployment gate') : t('Edit deployment gate')}</p>
            <label className="editor-label">
              {t('Deployment workflow')}
              <input
                list="deployment-workflow-options"
                value={deploymentDraft.workflowName}
                placeholder="Deploy frontend to Vercel"
                onChange={(event) => updateDeploymentDraft({ workflowName: event.target.value })}
              />
              <datalist id="deployment-workflow-options">
                {(options?.workflows ?? []).map((workflow) => <option key={workflow.path} value={workflow.name}>{workflow.path}</option>)}
              </datalist>
            </label>
            <div className="editor-grow-row">
              <label>
                {t('target branch')}
                <select
                  value={deploymentDraft.target}
                  onChange={(event) => updateDeploymentDraft({ target: event.target.value })}
                >
                  {deploymentTargets.map((target) => <option key={target} value={target}>{target}</option>)}
                </select>
              </label>
              <label>
                {t('provider')}
                <select
                  value={deploymentDraft.provider}
                  onChange={(event) => updateDeploymentDraft({ provider: event.target.value as DeploymentConfig['provider'] })}
                >
                  <option value="vercel">Vercel</option>
                  <option value="cloudflare">Cloudflare Pages</option>
                </select>
              </label>
              <label>
                {t('environment')}
                <select
                  value={deploymentDraft.environment}
                  onChange={(event) => updateDeploymentDraft({ environment: event.target.value as DeploymentConfig['environment'] })}
                >
                  <option value="preview">{t('preview')}</option>
                  <option value="production">{t('production')}</option>
                </select>
              </label>
            </div>
            <details className="deployment-advanced" open={Boolean(deploymentDraft.healthCheckPath || deploymentDraft.rollbackWorkflowName || deploymentDraft.githubEnvironment)}>
              <summary>{t('advanced')}</summary>
              <label className="editor-label">
                {t('GitHub Environment')}
                <input
                  list="deployment-environment-options"
                  value={deploymentDraft.githubEnvironment ?? ''}
                  placeholder={!options || !options.environmentsAvailable ? 'preview-vercel' : options.environments[0] ?? ''}
                  onChange={(event) => updateDeploymentDraft({ githubEnvironment: event.target.value })}
                />
                <datalist id="deployment-environment-options">
                  {(options?.environments ?? []).map((environment) => <option key={environment} value={environment} />)}
                </datalist>
                <small>
                  {!options
                    ? t('Could not load GitHub Environments — leave blank to derive the conventional name')
                    : !options.environmentsAvailable
                      ? t('Could not load GitHub Environments — leave blank to derive the conventional name')
                      : options.environments.length
                        ? t('Choose one of the repository’s GitHub Environments, or leave blank to derive the conventional name')
                        : t('This repository has no GitHub Environments — leave blank')}
                </small>
              </label>
              <label className="editor-label">
                {t('health check path')}
                <input
                  value={deploymentDraft.healthCheckPath ?? ''}
                  placeholder="/health"
                  onChange={(event) => updateDeploymentDraft({ healthCheckPath: event.target.value })}
                />
                <small>{t('Optional. Must start with / and is probed after a successful deployment.')}</small>
              </label>
              <label className="editor-label">
                {t('rollback workflow')}
                <input
                  list="deployment-workflow-options"
                  value={deploymentDraft.rollbackWorkflowName ?? ''}
                  placeholder="Rollback production deployment"
                  onChange={(event) => updateDeploymentDraft({ rollbackWorkflowName: event.target.value })}
                />
                <small>{t('Optional. The managed repository must already contain this workflow; pr-helper-git dispatches it.')}</small>
              </label>
            </details>
            <div className="editor-automation">
              <button type="button" className="drawer-btn primary small" onClick={submitDeployment}>
                {deploymentEditIndex === null ? t('add gate') : t('save gate')}
              </button>
              <button type="button" className="drawer-btn small" onClick={() => { setDeploymentFormOpen(false); setDeploymentDraft(null); setDeploymentEditIndex(null); }}>
                {t('Cancel')}
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="editor-card">
        <span className="drawer-label">{t('AI automation credential')}</span>
        <p className="editor-hint">{ai?.configured ? tp('configured · model {model} · key {mask}', { model: ai.model ?? '—', mask: ai.keyMask ?? '—' }) : t('not configured — required to draft auto-created PR messages')}</p>
        <div className="editor-recovery editor-grow-row">
          <label>
            {t('base URL')}
            <input
              value={aiForm.baseUrl}
              onChange={(event) => setAiForm((current) => ({ ...current, baseUrl: event.target.value }))}
              placeholder="https://api.openai.com/v1"
            />
          </label>
          <label>
            {t('model')}
            <input
              value={aiForm.model}
              onChange={(event) => setAiForm((current) => ({ ...current, model: event.target.value }))}
              placeholder="gpt-4o-mini"
            />
          </label>
          <label className="editor-grow">
            {t('API key')}
            <input
              type="password"
              value={aiForm.apiKey}
              onChange={(event) => setAiForm((current) => ({ ...current, apiKey: event.target.value }))}
              placeholder={ai?.configured ? t('leave empty to keep the saved key') : 'sk-…'}
            />
          </label>
        </div>
        <div className="editor-automation">
          <label className="editor-toggle">
            <input
              type="checkbox"
              checked={aiForm.autoGeneratePrMessage}
              onChange={(event) => setAiForm((current) => ({ ...current, autoGeneratePrMessage: event.target.checked }))}
            />
            {t('auto-generate PR message')}
          </label>
          <label className="editor-toggle">
            <input
              type="checkbox"
              checked={aiForm.autoConfirmPrCreation}
              onChange={(event) => setAiForm((current) => ({ ...current, autoConfirmPrCreation: event.target.checked }))}
            />
            {t('auto-confirm PR creation')}
          </label>
          <button type="button" className="drawer-btn small" disabled={saving} onClick={() => void saveAi()}>
            {t('save credential')}
          </button>
          <button type="button" className="drawer-btn small" disabled={!ai?.configured || saving} onClick={() => void testAi()}>
            {t('test saved credential')}
          </button>
          {ai?.configured ? (
            <button type="button" className="drawer-btn small" disabled={saving} onClick={() => void removeAi()}>
              {t('delete credential')}
            </button>
          ) : null}
        </div>
      </section>

      <section className="editor-card">
        <span className="drawer-label">{t('Recovery policy')}</span>
        <div className="editor-recovery">
          <label>
            {t('max retries')}
            <input
              type="number"
              min={0}
              max={10}
              value={draft.recoveryPolicy?.maxRetries ?? 3}
              onChange={(event) => setDraft((current) => ({
                ...current,
                recoveryPolicy: { ...(current.recoveryPolicy ?? { cooldownSeconds: 900 }), maxRetries: Math.max(0, Number(event.target.value) || 0) },
              }))}
            />
          </label>
          <label>
            {t('cooldown seconds')}
            <input
              type="number"
              min={0}
              max={86400}
              value={draft.recoveryPolicy?.cooldownSeconds ?? 900}
              onChange={(event) => setDraft((current) => ({
                ...current,
                recoveryPolicy: { maxRetries: current.recoveryPolicy?.maxRetries ?? 3, cooldownSeconds: Math.max(0, Number(event.target.value) || 0) },
              }))}
            />
          </label>
        </div>
      </section>
    </div>
  );
}
