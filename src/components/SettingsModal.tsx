import { useState } from 'react';
import { useApp } from '../app-state';

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
        <h3>GitHub settings</h3>
        <p className="modal-detail">
          A personal access token is used only for the pull-request features and
          is stored in this browser only. Requests are proxied through the local
          loopback server; the token is never written to disk.
        </p>
        <input
          autoFocus
          type="password"
          className="input"
          placeholder="github_pat_…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <p className="modal-detail">
          Create one at{' '}
          <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer">
            github.com/settings/tokens
          </a>{' '}
          with repo pull-request and checks permissions.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">Save</button>
        </div>
      </form>
    </div>
  );
}
