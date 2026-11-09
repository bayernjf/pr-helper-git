import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import { getConfig, saveConfig, type ConfigEntry } from '../api';
import { IconX } from './icons';
import { Dropdown } from './Dropdown';
import { t } from '../i18n';

interface Props {
  onClose: () => void;
}

export default function ConfigModal({ onClose }: Props) {
  const { activeRepo } = useApp();
  const [entries, setEntries] = useState<ConfigEntry[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [initial, setInitial] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEscape(onClose);

  function applyEntries(list: ConfigEntry[]) {
    setEntries(list);
    const next: Record<string, string> = {};
    for (const e of list) next[e.key] = e.local ?? e.effective ?? '';
    setDrafts(next);
    setInitial(next);
  }

  useEffect(() => {
    let cancelled = false;
    if (!activeRepo) return;
    setLoading(true);
    getConfig(activeRepo)
      .then((res) => {
        if (!cancelled) {
          applyEntries(res.entries);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeRepo]);

  // A row is dirty when its edited value differs from the loaded snapshot.
  const dirtyKeys = useMemo(
    () => entries.filter((e) => (drafts[e.key] ?? '') !== (initial[e.key] ?? '')).map((e) => e.key),
    [entries, drafts, initial],
  );

  async function handleSave() {
    if (!activeRepo || dirtyKeys.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      for (const key of dirtyKeys) {
        // An empty value clears the local override and restores inheritance.
        await saveConfig(activeRepo, key, drafts[key] ?? '');
      }
      const res = await getConfig(activeRepo);
      applyEntries(res.entries);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t("Repository settings")}</h2>
          <button type="button" className="icon-btn" aria-label={t("Close")} title={t("Close")} onClick={onClose}>
            <IconX />
          </button>
        </div>
        <div className="modal-body">
          <div className="hint config-hint">
            {t("Changes write to this repository's local config. Leave a field blank to remove the local override and inherit the global/system value.")}
          </div>
          {loading && <div className="config-status">{t("Loading…")}</div>}
          {error && <div className="config-status config-error">{error}</div>}
          {!loading && (
            <div className="config-list">
              {entries.map((entry) => (
                <div className="config-row" key={entry.key}>
                  <div className="config-key">
                    <span>{entry.key}</span>
                    {entry.inherited && (drafts[entry.key] ?? '') === (entry.effective ?? '') && (
                      <span className="config-badge">{t("inherited")}</span>
                    )}
                  </div>
                  <div className="config-control">
                    {entry.type === 'enum' ? (
                      <Dropdown
                        value={drafts[entry.key] ?? ''}
                        onChange={(v) =>
                          setDrafts((prev) => ({ ...prev, [entry.key]: v }))
                        }
                        options={[
                          { value: '', label: t('(inherited / unset)') },
                          ...entry.options!.map((opt) => ({ value: opt, label: opt })),
                        ]}
                      />
                    ) : (
                      <input
                        type={entry.type === 'email' ? 'email' : 'text'}
                        autoComplete="off"
                        spellCheck={false}
                        value={drafts[entry.key] ?? ''}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [entry.key]: e.target.value }))
                        }
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>{t("Close")}</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving || dirtyKeys.length === 0}
            onClick={handleSave}
          >
            {saving ? 'Saving…' : `Save${dirtyKeys.length ? ` (${dirtyKeys.length})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
