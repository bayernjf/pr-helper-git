import { useState } from 'react';
import { githubProxy } from '../api';
import { usePreferences } from '../app-state/hooks';
import { useAppToast } from '../app-state/toast';
import { useEscape } from '../hooks/use-escape';
import { errorDetail, errorMessage } from '../lib/errors';
import { t } from '../i18n';
import { IconX } from './icons';

interface Props {
  repository: string;
  source: string;
  target: string;
  onClose: () => void;
  onCreated: () => void;
}

/**
 * Upstream Flows created a pull request through a dialog with an editable
 * title/body instead of only enqueueing an automation action. This keeps the
 * same direct GitHub POST while using the stage's fixed source/target.
 */
export default function FlowCreatePrModal({ repository, source, target, onClose, onCreated }: Props) {
  const { pat } = usePreferences();
  const toast = useAppToast();
  useEscape(onClose);
  const [title, setTitle] = useState(`${source} → ${target}`);
  const [body, setBody] = useState('');
  const [draft, setDraft] = useState(false);
  const [saving, setSaving] = useState(false);
  const [inlineError, setInlineError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || !repository.includes('/') || source === target) return;
    setSaving(true);
    setInlineError('');
    try {
      await githubProxy(pat, `/repos/${repository}/pulls`, 'POST', {
        title: title.trim(),
        head: source,
        base: target,
        body,
        draft,
      });
      toast(t('Pull request created'), 'success');
      onCreated();
    } catch (err) {
      const msg = errorDetail(err) ? `${errorMessage(err)}: ${errorDetail(err)}` : errorMessage(err);
      setInlineError(msg);
      toast(msg, 'error');
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <form className="modal" onClick={(event) => event.stopPropagation()} onSubmit={submit}>
        {inlineError ? <div className="drawer-error">{inlineError}</div> : null}
        <div className="modal-header">
          <h2>{t('New pull request')}</h2>
          <button type="button" className="icon-btn" aria-label={t('Close')} onClick={onClose}><IconX /></button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="flow-pr-base">{t('Base')}</label>
              <input id="flow-pr-base" value={target} readOnly />
            </div>
            <div className="form-group">
              <label htmlFor="flow-pr-head">{t('Compare')}</label>
              <input id="flow-pr-head" value={source} readOnly />
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="flow-pr-title">{t('Title')}</label>
            <input
              id="flow-pr-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('Short imperative summary')}
            />
          </div>
          <div className="form-group">
            <label htmlFor="flow-pr-body">{t('Description')}</label>
            <textarea
              id="flow-pr-body"
              rows={7}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </div>
          <label className="checkbox-row">
            <input type="checkbox" checked={draft} onChange={(event) => setDraft(event.target.checked)} />
            {t('Open as draft (not ready for review)')}
          </label>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>{t('Cancel')}</button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={saving || !title.trim() || source === target}
          >
            {saving ? t('Creating…') : t('Create pull request')}
          </button>
        </div>
      </form>
    </div>
  );
}
