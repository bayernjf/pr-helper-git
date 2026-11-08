import { useState } from 'react';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import { moveFile } from '../api';
import { IconX } from './icons';
import { t } from '../i18n';

interface Props {
  path: string;
  onClose: () => void;
}

export default function RenameFileModal({ path: currentPath, onClose }: Props) {
  const { activeRepo, runAction } = useApp();
  const [value, setValue] = useState(currentPath);
  useEscape(onClose);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const next = value.trim();
    if (!next || next === currentPath || !activeRepo) return;
    const result = await runAction(
      moveFile(activeRepo, currentPath, next),
      `Renamed to ${next}`,
    );
    if (result !== null) onClose();
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <form className="modal" style={{ width: 440 }} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-header">
          <h2>{t("Rename or move")}</h2>
          <button type="button" className="icon-btn" aria-label={t("Close")} title={t("Close")} onClick={onClose}><IconX /></button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>{t("New path")}</label>
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <div className="hint">{t("git mv keeps the history and stages the rename.")}</div>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>{t("Cancel")}</button>
          <button type="submit" className="btn btn-primary" disabled={!value.trim() || value === currentPath}>
            Rename
          </button>
        </div>
      </form>
    </div>
  );
}
