import { useState } from 'react';
import { useApp } from '../app-state';
import { IconX } from './icons';

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const { pat, setPat } = useApp();
  const [value, setValue] = useState(pat);

  function save(event: React.FormEvent) {
    event.preventDefault();
    setPat(value.trim());
    onClose();
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="modal-header">
          <h2>GitHub settings</h2>
          <button type="button" className="icon-btn" onClick={onClose}><IconX /></button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>Personal access token</label>
            <input
              autoFocus
              type="password"
              placeholder="github_pat_…"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <div className="hint">
              Stored in this browser only and proxied via the loopback server;
              never written to disk. Create one at{' '}
              <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer">
                github.com/settings/tokens
              </a>
              .
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">Save</button>
        </div>
      </form>
    </div>
  );
}
