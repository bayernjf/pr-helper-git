import { useState } from 'react';
import { createTag } from '../api';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import { IconX } from './icons';
import { t } from '../i18n';

interface Props {
  repo: string;
  fromRef?: string;
  onClose: () => void;
}

export default function TagModal({ repo, fromRef, onClose }: Props) {
  const { runAction } = useApp();
  const [name, setName] = useState('');
  useEscape(onClose);
  const [annotated, setAnnotated] = useState(true);
  const [message, setMessage] = useState('');
  const [force, setForce] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const tag = name.trim();
    if (!tag) return;
    const result = await runAction(
      createTag(repo, tag, annotated ? message.trim() || tag : undefined, fromRef, force),
      `Tag ${tag} created`,
    );
    if (result !== null) onClose();
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-header">
          <h2>{t("Create a tag")}</h2>
          <button type="button" className="icon-btn" aria-label={t("Close")} title={t("Close")} onClick={onClose}><IconX /></button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label htmlFor="tag-name">{t("Tag name")}</label>
            <input
              id="tag-name"
              autoFocus
              placeholder="v1.2.0"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {fromRef && <div className="hint">Points to {fromRef.slice(0, 9)}</div>}
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={annotated}
              onChange={(e) => setAnnotated(e.target.checked)}
            />
            Annotated tag (stores a message)
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
            />
            Force overwrite if the tag already exists (-f)
          </label>
          {annotated && (
            <div className="form-group">
              <label htmlFor="tag-message">{t("Message")}</label>
              <textarea
                id="tag-message"
                rows={3}
                placeholder={t("Release notes")}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>{t("Cancel")}</button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
            Create tag
          </button>
        </div>
      </form>
    </div>
  );
}
