import { useState } from 'react';
import { stashCreate } from '../api';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import { IconX } from './icons';

export default function StashModal({ onClose }: { onClose: () => void }) {
  const { activeRepo, runAction } = useApp();
  const [message, setMessage] = useState('');
  const [includeUntracked, setIncludeUntracked] = useState(false);
  useEscape(onClose);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!activeRepo) return;
    const result = await runAction(
      stashCreate(activeRepo, message.trim() || undefined, includeUntracked),
      'Stashed',
    );
    if (result !== null) onClose();
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-header">
          <h2>Stash changes</h2>
          <button type="button" className="icon-btn" onClick={onClose}><IconX /></button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>Message (optional)</label>
            <input
              autoFocus
              type="text"
              placeholder="WIP on current branch"
              value={message}
              maxLength={200}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={includeUntracked}
              onChange={(e) => setIncludeUntracked(e.target.checked)}
            />
            <span>Include untracked files (<code>--include-untracked</code>)</span>
          </label>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">Stash</button>
        </div>
      </form>
    </div>
  );
}
