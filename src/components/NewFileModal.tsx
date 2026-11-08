import { useState } from 'react';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import { saveFile } from '../api';
import { IconX } from './icons';
import { t } from '../i18n';

interface Props {
  onClose: () => void;
  onCreated: (path: string) => void;
}

export default function NewFileModal({ onClose, onCreated }: Props) {
  const { activeRepo, runAction } = useApp();
  const [value, setValue] = useState('');
  useEscape(onClose);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const target = value.trim();
    if (!target || !activeRepo) return;
    // expectedMtime is null because the file does not exist yet, so the
    // stale-save guard is skipped and /api/save creates it.
    const result = await runAction(saveFile(activeRepo, target, '', null), `Created ${target}`);
    if (result !== null) {
      onCreated(target);
      onClose();
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <form className="modal" style={{ width: 440 }} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-header">
          <h2>{t("New file")}</h2>
          <button type="button" className="icon-btn" aria-label={t("Close")} title={t("Close")} onClick={onClose}><IconX /></button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>{t("File path")}</label>
            <input
              autoFocus
              value={value}
              placeholder="path/to/file.txt"
              onChange={(e) => setValue(e.target.value)}
            />
            <div className="hint">
              {t("Created relative to the repository root; the editor opens so you can add content.")}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>{t("Cancel")}</button>
          <button type="submit" className="btn btn-primary" disabled={!value.trim()}>
            {t("Create")}</button>
        </div>
      </form>
    </div>
  );
}
