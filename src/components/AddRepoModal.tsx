import { useState } from 'react';
import { addRepo } from '../api';
import { useApp } from '../app-state';
import { IconX } from './icons';

export default function AddRepoModal({ onClose }: { onClose: () => void }) {
  const { selectRepo, refreshRepos, toast } = useApp();
  const [path, setPath] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const target = path.trim();
    if (!target) return;
    setSaving(true);
    try {
      await addRepo(target);
      const updated = await refreshRepos();
      const match = updated.find((r) => r.path === target) || updated[updated.length - 1];
      if (match) selectRepo(match.path);
      onClose();
    } catch (err: any) {
      toast(err.detail ? `${err.message}: ${err.detail}` : err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-header">
          <h2>Add a local repository</h2>
          <button type="button" className="icon-btn" onClick={onClose}><IconX /></button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>Repository path</label>
            <input
              autoFocus
              placeholder="/Users/you/000mycodes/some-repo"
              value={path}
              onChange={(e) => setPath(e.target.value)}
            />
            <div className="hint">Paste the absolute path of a folder that contains a .git directory.</div>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving || !path.trim()}>
            {saving ? 'Adding…' : 'Add repository'}
          </button>
        </div>
      </form>
    </div>
  );
}
