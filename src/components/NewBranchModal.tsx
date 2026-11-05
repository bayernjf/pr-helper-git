import { useState } from 'react';
import { createBranch } from '../api';
import { useApp } from '../app-state';
import { useToast } from './ui';

export default function NewBranchModal({ onClose }: { onClose: () => void }) {
  const { activeRepo, refs, runAction } = useApp();
  const toast = useToast();
  const [name, setName] = useState('');
  const [from, setFrom] = useState('');

  const branchRefs = refs.filter((r) => r.name.startsWith('refs/heads/') || r.name.startsWith('refs/tags/'));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const branch = name.trim();
    if (!branch) return;
    const result = await runAction(
      createBranch(activeRepo!, branch, from || undefined),
      `Created and switched to ${branch}`,
    );
    if (result !== null) onClose();
    else toast.error('Branch creation failed');
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>Create a branch</h3>
        <div className="form-row">
          <label htmlFor="branch-name">Name</label>
          <input
            id="branch-name"
            autoFocus
            className="input"
            placeholder="feature/short-description"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="form-row">
          <label htmlFor="branch-from">Start from</label>
          <select id="branch-from" className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Current HEAD</option>
            {branchRefs.map((r) => (
              <option key={r.name} value={r.shortName}>
                {r.shortName}
              </option>
            ))}
          </select>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
            Create branch
          </button>
        </div>
      </form>
    </div>
  );
}
