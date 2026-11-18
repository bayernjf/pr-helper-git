// Generation rules manager (P3-4 tail): list / create / edit / delete the
// migrated pr_helper_generation_rules. Names are a local-only column
// (migration 049 — the original kept names in its client localStorage).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { errorMessage } from '../lib/errors';
import { deleteRule, fetchGenerationRules, saveRule, type GenerationRuleRow } from '../api/flows';
import { t } from '../i18n';
import { IconX } from './icons';

export default function GenerationRulesModal({ onClose, onChanged }: {
  onClose: () => void;
  /** Notifies that rules changed so pinned-rule UI can refresh. */
  onChanged?: () => void;
}) {
  const [rules, setRules] = useState<GenerationRuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ hash: string | null; name: string; content: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const { rules: list } = await fetchGenerationRules();
      setRules(list);
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    if (!editing) return;
    if (!editing.name.trim() || !editing.content.trim()) {
      setError(t('rule needs a name and non-empty content'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await saveRule({ name: editing.name.trim(), content: editing.content });
      await load();
      onChanged?.();
      setEditing(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(hash: string) {
    setBusy(true);
    setError('');
    try {
      await deleteRule(hash);
      await load();
      onChanged?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="modal-header">
          <h2>{t('Generation rules')}</h2>
          <button type="button" className="m-icon-btn" aria-label={t('Close')} onClick={onClose}>
            <IconX width={18} height={18} />
          </button>
        </div>
        <div className="modal-body">
          {error ? <div className="drawer-error">{error}</div> : null}
          {loading ? (
            <p className="editor-hint">{t('Loading…')}</p>
          ) : (
            <>
              {rules.map((rule) => (
                <div key={rule.contentHash} className="rule-row">
                  <div className="rule-row-main">
                    <b>{rule.name}</b>
                    <small>{rule.content}</small>
                  </div>
                  <div className="rule-row-ops">
                    <button
                      type="button"
                      className="drawer-btn small"
                      onClick={() => setEditing({ hash: rule.contentHash, name: rule.name, content: rule.content })}
                    >
                      {t('Edit')}
                    </button>
                    <button
                      type="button"
                      className="drawer-btn small"
                      disabled={busy}
                      onClick={() => void remove(rule.contentHash)}
                    >
                      {t('Delete')}
                    </button>
                  </div>
                </div>
              ))}
              {rules.length === 0 ? <p className="editor-hint">{t('No rules yet — add the prompt template used to draft PR messages.')}</p> : null}
              {editing === null ? (
                <button
                  type="button"
                  className="drawer-btn"
                  onClick={() => setEditing({ hash: null, name: '', content: '' })}
                >
                  {t('add rule')}
                </button>
              ) : (
                <div className="rule-edit">
                  <label>
                    {t('Rule name')}
                    <input
                      value={editing.name}
                      onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                    />
                  </label>
                  <label>
                    {t('Rule content (prompt template)')}
                    <textarea
                      value={editing.content}
                      rows={8}
                      onChange={(event) => setEditing({ ...editing, content: event.target.value })}
                    />
                  </label>
                  <div className="takeover-ops">
                    <button type="submit" className="drawer-btn primary small" disabled={busy}>
                      {t('Save')}
                    </button>
                    <button type="button" className="drawer-btn small" onClick={() => setEditing(null)}>
                      {t('Cancel')}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </form>
    </div>,
    document.body,
  );
}
