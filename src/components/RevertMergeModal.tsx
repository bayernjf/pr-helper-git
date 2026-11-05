import { useState } from 'react';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import { revertCommit } from '../api';
import { IconX } from './icons';

interface Props {
  hash: string;
  parentCount: number;
  onClose: () => void;
}

export default function RevertMergeModal({ hash, parentCount, onClose }: Props) {
  const { currentRepo, runAction } = useApp();
  const [mainline, setMainline] = useState(1);
  useEscape(onClose);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!currentRepo) return;
    const result = await runAction(
      revertCommit(currentRepo, hash, mainline),
      'Merge commit reverted',
    );
    if (result !== null) onClose();
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <form className="modal" style={{ width: 460 }} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-header">
          <h2>Revert merge commit</h2>
          <button type="button" className="icon-btn" onClick={onClose}><IconX /></button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>Mainline parent</label>
            <p className="hint" style={{ marginTop: 0 }}>
              Reverting a merge needs a mainline (-m). Parent 1 is the branch checked out
              when the merge happened; changes introduced by the other parents are undone.
            </p>
            <select
              value={mainline}
              onChange={(e) => setMainline(Number(e.target.value))}
            >
              {Array.from({ length: parentCount }, (_, i) => (
                <option key={i + 1} value={i + 1}>Parent {i + 1}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">Revert</button>
        </div>
      </form>
    </div>
  );
}
