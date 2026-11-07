import { useState } from 'react';
import { createBranch } from '../api';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import { IconX } from './icons';

interface Props {
  repo: string;
  fromRef?: string;
  onClose: () => void;
}

export default function NewBranchModal({ repo, fromRef, onClose }: Props) {
  const { refs, runAction } = useApp();
  const [name, setName] = useState('');
  const [noCheckout, setNoCheckout] = useState(false);
  useEscape(onClose);
  const [from, setFrom] = useState(fromRef || '');

  const branchRefs = refs.filter(
    (r) => r.name.startsWith('refs/heads/') || r.name.startsWith('refs/tags/'),
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const branch = name.trim();
    if (!branch) return;
    const result = await runAction(
      createBranch(repo, branch, from || undefined, noCheckout),
      noCheckout ? `Created ${branch}` : `Created and switched to ${branch}`,
    );
    if (result !== null) onClose();
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-header">
          <h2>Create a branch</h2>
          <button type="button" className="icon-btn" aria-label="Close" title="Close" onClick={onClose}><IconX /></button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label htmlFor="branch-name">Branch name</label>
            <input
              id="branch-name"
              autoFocus
              placeholder="feature/short-description"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="branch-from">Start from</label>
            {fromRef ? (
              <input value={fromRef} readOnly />
            ) : (
              <select id="branch-from" value={from} onChange={(e) => setFrom(e.target.value)}>
                <option value="">Current HEAD</option>
                {branchRefs.map((r) => (
                  <option key={r.name} value={r.shortName}>{r.shortName}</option>
                ))}
              </select>
            )}
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={noCheckout}
              onChange={(e) => setNoCheckout(e.target.checked)}
            />
            Create branch without switching
          </label>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
            Create branch
          </button>
        </div>
      </form>
    </div>
  );
}
