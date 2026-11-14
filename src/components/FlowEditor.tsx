// Flow editor (Phase 3, P3-4 + P3-7): edits an existing flow's identity,
// step routes, automation toggles and recovery policy. The automation
// mutations use the ported pure helpers (setStageAutoCreate/AutoMerge/
// AutoAdvance) and the toggle confirmation mirrors the original
// confirmImmediateAutomation interaction: flipping a switch computes the
// immediate effect on the persisted projection and asks before it saves.
//
// Slice scope: editing an existing flow. Creating from scratch, drag
// ordering, and the deployment form follow in the next slice.
import { useMemo, useState } from 'react';
import { useToast } from './ui';
import { errorMessage } from '../lib/errors';
import {
  setStageAutoCreate,
  setStageAutoMerge,
  setStageAutoAdvance,
  addStage,
  removeStage,
  createWorkflow,
  type Workflow,
} from '../lib/automation/workflow';
import { immediateAutomationEffect } from '../lib/automation/workflow';
import { projectedStageStatus } from '../lib/automation/projected-stage';
import { matchingStageProjections } from '../lib/automation/workflow';
import { saveWorkflowToServer } from '../api/flows';
import type { BoardState } from '../lib/automation/flows-board';
import { t, tp } from '../i18n';

type EditorStage = Workflow['stages'][number];

/**
 * The four prerequisites upstream requires before automation toggles may be
 * flipped (P3-7): without an AI automation credential the generated PR body
 * has no author. The local build reports them read-only until the credential
 * surface (M-E) is migrated.
 */
function automationPrerequisites(inbox?: { readWarnings?: Array<{ source: string; message: string }> } | null): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!inbox) missing.push(t('projection unavailable'));
  return { ok: missing.length === 0, missing };
}

/** Immediate effect confirmation copy, mirroring the original dialog. */
function effectText(effect: ReturnType<typeof immediateAutomationEffect>): string | null {
  if (effect.kind === 'none') return null;
  if (effect.kind === 'merge-pr') {
    return tp('Enabling auto-merge will merge PR #{number} immediately once gates pass.', { number: effect.pullNumber });
  }
  return tp('Enabling auto-create will create the PR immediately ({count} new commits).', { count: effect.aheadBy });
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
  const [draft, setDraft] = useState<Workflow>(
    () => structuredClone(workflow ?? initialDraft ?? createWorkflow('', 'dev', 'main')),
  );
  const isCreate = workflow === undefined;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const prerequisites = useMemo(() => automationPrerequisites(inbox), [inbox]);


  function patchStage(stageIndex: number, patch: (stage: EditorStage) => EditorStage) {
    setDraft((current) => ({
      ...current,
      stages: current.stages.map((stage, index) => (index === stageIndex ? patch(stage) : stage)),
    }));
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
    // rule (name+content) on enable; the local rule library is not migrated
    // yet (M-E), so a rule without stored content cannot be composed here.
    const pinned = stage.automation?.generationRule;
    const rule = pinned && pinned.content ? { name: pinned.name, content: pinned.content } : undefined;
    if (toggle === 'create' && enabling && !rule) {
      toast.error(t('rule content not stored locally — automation editing needs the rule library (M-E)'));
      return;
    }
    setDraft((current) => {
      if (toggle === 'create') {
        return setStageAutoCreate(current, stageIndex, enabling, rule, stage.automation?.triggerMinCommits || 1);
      }
      if (toggle === 'merge') return setStageAutoMerge(current, stageIndex, enabling);
      return setStageAutoAdvance(current, stageIndex, enabling);
    });
  }

  async function save() {
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
          <p className="detail-eyebrow">{workflow?.repository || t('New flow')}</p>
          <h1>{isCreate ? t('New flow') : t('Edit flow')}</h1>
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
          <summary>{t('Automation prerequisites unmet — toggles may refuse to enable')}</summary>
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
            value={draft.repository}
            disabled={!isCreate}
            placeholder={t('owner/repo')}
            onChange={(event) => setDraft((current) => ({ ...current, repository: event.target.value }))}
          />
        </label>
      </section>

      <section className="editor-card">
        <span className="drawer-label">{t('Steps')}</span>
        {draft.stages.map((stage, index) => (
          <article key={stage.stageId ?? index} className="editor-stage">
            <div className="editor-stage-routes">
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
                  disabled={stage.automation?.autoCreatePullRequest !== true}
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
                  onChange={(event) => void toggleAutomation(index, 'merge', event.target.checked)}
                />
                {t('auto-merge')}
              </label>
              <label className="editor-toggle">
                <input
                  type="checkbox"
                  checked={(stage.automation as { autoAdvanceNext?: true } | undefined)?.autoAdvanceNext === true}
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
          </article>
        ))}
        <button
          type="button"
          className="drawer-btn"
          onClick={() => setDraft((current) => addStage(current, 'feature', current.stages[current.stages.length - 1]?.target || 'main'))}
        >
          {t('add step')}
        </button>
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
