import { useCallback, useEffect, useState } from 'react';
import {
  addRemote,
  getRemotes,
  removeRemote,
} from '../api';
import { useApp } from '../app-state';
import type { RemoteEntry } from '../types';
import { IconTrash, IconX } from './icons';
import { useConfirm } from './ui';

export default function RemoteModal({ onClose }: { onClose: () => void }) {
  const { activeRepo, toast } = useApp();
  const confirm = useConfirm();
  const [remotes, setRemotes] = useState<RemoteEntry[]>([]);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [working, setWorking] = useState(false);

  const reload = useCallback(() => {
    if (!activeRepo) return;
    getRemotes(activeRepo).then((r) => setRemotes(r.remotes)).catch(() => setRemotes([]));
  }, [activeRepo]);

  useEffect(() => { reload(); }, [reload]);

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    const rName = name.trim();
    const rUrl = url.trim();
    if (!rName || !rUrl) return;
    setWorking(true);
    try {
      await addRemote(activeRepo!, rName, rUrl);
      setName('');
      setUrl('');
      toast('Remote added', 'success');
      reload();
    } catch (err: any) {
      toast(err.detail ? `${err.message}: ${err.detail}` : err.message, 'error');
    } finally {
      setWorking(false);
    }
  }

  async function handleRemove(entry: RemoteEntry) {
    const proceed = await confirm(
      `Remove remote "${entry.name}"?`,
      'Tracking branches and configured upstreams for this remote are removed from local config.',
    );
    if (!proceed) return;
    setWorking(true);
    try {
      await removeRemote(activeRepo!, entry.name);
      toast('Remote removed', 'success');
      reload();
    } catch (err: any) {
      toast(err.detail ? `${err.message}: ${err.detail}` : err.message, 'error');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Remotes</h2>
          <button type="button" className="icon-btn" onClick={onClose}><IconX /></button>
        </div>
        <div className="modal-body">
          {remotes.length === 0 ? (
            <div className="detail-value muted">No remotes configured.</div>
          ) : (
            <div className="pr-detail-list" style={{ marginBottom: 16 }}>
              {remotes.map((r) => (
                <div key={r.name} className="pr-detail-item">
                  <span style={{ fontWeight: 600, minWidth: 64 }}>{r.name}</span>
                  <span
                    className="detail-value muted"
                    style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}
                  >
                    {r.fetch || r.push}
                  </span>
                  <button
                    type="button"
                    className="icon-btn"
                    title="Remove remote"
                    disabled={working}
                    onClick={() => handleRemove(r)}
                  >
                    <IconTrash width={13} height={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleAdd}>
            <div className="detail-label" style={{ marginBottom: 8 }}>Add a remote</div>
            <div className="remote-add-form">
              <input
                value={name}
                placeholder="origin"
                aria-label="Remote name"
                onChange={(e) => setName(e.target.value)}
              />
              <input
                value={url}
                placeholder="https://github.com/owner/repo.git"
                aria-label="Remote URL"
                onChange={(e) => setUrl(e.target.value)}
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={working || !name.trim() || !url.trim()}
              >
                Add
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
