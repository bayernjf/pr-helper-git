import { useState } from 'react';
import { addRepo } from '../api';
import { useApp } from '../app-state';
import { useToast } from './ui';

export default function AddRepoModal({ onClose }: { onClose: () => void }) {
  const { selectRepo, refreshRepos } = useApp();
  const toast = useToast();
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
      // The server resolves and stores the absolute path.
      const match = updated.find((r) => r.path === target) || updated[updated.length - 1];
      if (match) selectRepo(match.path);
      onClose();
    } catch (err: any) {
      toast.error(err.detail ? `${err.message}: ${err.detail}` : err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>Add a local repository</h3>
        <p className="modal-detail">Paste the absolute path of a folder that contains a .git directory.</p>
        <input
          autoFocus
          className="input"
          placeholder="/Users/you/000mycodes/some-repo"
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving || !path.trim()}>
            {saving ? 'Adding…' : 'Add repository'}
          </button>
        </div>
      </form>
    </div>
  );
}
