import { useCallback, useEffect, useState } from 'react';
import {
  addRemote,
  getRemotes,
  removeRemote,
  renameRemote,
  setRemoteUrl,
} from '../api';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import type { RemoteEntry } from '../types';
import { IconCheck, IconEdit, IconTrash, IconX } from './icons';
import { useConfirm } from './ui';

export default function RemoteModal({ onClose }: { onClose: () => void }) {
  const { activeRepo, toast } = useApp();
  const confirm = useConfirm();
  useEscape(onClose);
  const [remotes, setRemotes] = useState<RemoteEntry[]>([]);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [working, setWorking] = useState(false);
  const [editing, setEditing] = useState<{ name: string; value: string } | null>(null);
  const [renaming, setRenaming] = useState<{ oldName: string; value: string } | null>(null);

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

  async function saveEdit() {
    if (!editing || !activeRepo) return;
    const value = editing.value.trim();
    if (!value) return;
    setWorking(true);
    try {
      await setRemoteUrl(activeRepo, editing.name, value);
      toast('Remote URL updated', 'success');
      setEditing(null);
      reload();
    } catch (err: any) {
      toast(err.detail ? `${err.message}: ${err.detail}` : err.message, 'error');
    } finally {
      setWorking(false);
    }
  }

  async function saveRename() {
    if (!renaming || !activeRepo) return;
    const value = renaming.value.trim();
    if (!value || !/^[A-Za-z0-9._-]{1,64}$/.test(value)) {
      toast('Invalid remote name', 'error');
      return;
    }
    setWorking(true);
    try {
      await renameRemote(activeRepo, renaming.oldName, value);
      toast('Remote renamed', 'success');
      setRenaming(null);
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
          <button type="button" className="icon-btn" aria-label="Close" title="Close" onClick={onClose}><IconX /></button>
        </div>
        <div className="modal-body">
          {remotes.length === 0 ? (
            <div className="detail-value muted">No remotes configured.</div>
          ) : (
            <div className="pr-detail-list" style={{ marginBottom: 16 }}>
              {remotes.map((r) => (
                <div key={r.name} className="pr-detail-item">
                  {renaming?.oldName === r.name ? (
                    <input
                      className="remote-edit-input"
                      style={{ maxWidth: 120 }}
                      autoFocus
                      value={renaming.value}
                      aria-label="Remote name"
                      onChange={(e) => setRenaming({ oldName: r.name, value: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveRename();
                        // Escape only cancels the inline edit; stop it from
                        // reaching the dialog's own Escape handler.
                        if (e.key === 'Escape') {
                          e.stopPropagation();
                          setRenaming(null);
                        }
                      }}
                    />
                  ) : (
                    <span style={{ fontWeight: 600, minWidth: 64 }}>{r.name}</span>
                  )}
                  {renaming?.oldName === r.name ? (
                    <button
                      type="button"
                      className="icon-btn"
                      title="Save name"
                      disabled={working}
                      onClick={saveRename}
                    >
                      <IconCheck width={13} height={13} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="icon-btn"
                      title="Rename remote"
                      disabled={working}
                      onClick={() => setRenaming({ oldName: r.name, value: r.name })}
                    >
                      <IconEdit width={13} height={13} />
                    </button>
                  )}
                  {editing?.name === r.name ? (
                    <input
                      className="remote-edit-input"
                      autoFocus
                      value={editing.value}
                      aria-label="Remote URL"
                      onChange={(e) => setEditing({ name: r.name, value: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit();
                        if (e.key === 'Escape') {
                          e.stopPropagation();
                          setEditing(null);
                        }
                      }}
                    />
                  ) : (
                    <span
                      className="detail-value muted"
                      style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}
                    >
                      {r.fetch || r.push}
                    </span>
                  )}
                  {editing?.name === r.name ? (
                    <button
                      type="button"
                      className="icon-btn"
                      title="Save URL"
                      disabled={working || !editing.value.trim()}
                      onClick={saveEdit}
                    >
                      <IconCheck width={13} height={13} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="icon-btn"
                      title="Edit URL"
                      disabled={working}
                      onClick={() => setEditing({ name: r.name, value: r.fetch || r.push || '' })}
                    >
                      <IconEdit width={13} height={13} />
                    </button>
                  )}
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
