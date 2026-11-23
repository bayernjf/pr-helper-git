import { useState, type FormEvent } from 'react';
import {
  addWorktree,
  lockWorktree,
  pruneWorktrees,
  removeWorktree,
  unlockWorktree,
  type WorktreeEntry,
} from '../api';
import { useAppToast } from '../app-state/toast';
import { useEscape } from '../hooks/use-escape';
import { errorMessage, errorStatus } from '../lib/errors';
import { t, tp } from '../i18n';
import { useConfirm } from './ui';

export default function WorktreeModal({
  repo,
  worktrees,
  onClose,
  onChanged,
}: {
  repo: string;
  worktrees: WorktreeEntry[];
  onClose: () => void;
  onChanged: (worktrees: WorktreeEntry[]) => void;
}) {
  const [items, setItems] = useState(worktrees);
  const [pathInput, setPathInput] = useState('');
  const [branch, setBranch] = useState('');
  const [createBranch, setCreateBranch] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const toast = useAppToast();
  const confirm = useConfirm();
  useEscape(onClose);

  const linked = items.filter((w) => !w.isMain);
  const prunable = items.filter((w) => w.prunable).length;
  const repoName = repo.split(/[\\/]/).filter(Boolean).pop() || 'repo';

  function apply(next: WorktreeEntry[]) {
    setItems(next);
    onChanged(next);
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy('create');
    try {
      const res = await addWorktree(repo, pathInput.trim(), branch.trim(), createBranch);
      apply(res.worktrees);
      setPathInput('');
      setBranch('');
      toast(t('Worktree created'), 'success');
    } catch (err) {
      setError(errorMessage(err) || t('Unable to create the worktree'));
    } finally {
      setBusy(null);
    }
  }

  async function lock(w: WorktreeEntry) {
    setError('');
    setBusy(w.path);
    try {
      const res = await lockWorktree(repo, w.path, t('Locked from PR Helper Git'));
      apply(res.worktrees);
      toast(t('Worktree locked'), 'success');
    } catch (err) {
      setError(errorMessage(err) || t('Unable to lock the worktree'));
    } finally {
      setBusy(null);
    }
  }

  async function unlock(w: WorktreeEntry) {
    setError('');
    setBusy(w.path);
    try {
      const res = await unlockWorktree(repo, w.path);
      apply(res.worktrees);
      toast(t('Worktree unlocked'), 'success');
    } catch (err) {
      setError(errorMessage(err) || t('Unable to unlock the worktree'));
    } finally {
      setBusy(null);
    }
  }

  async function remove(w: WorktreeEntry) {
    const ok = await confirm({
      title: tp('Remove the {name} worktree?', { name: w.branch || w.path }),
      detail: w.path,
      impact: t('Deletes the linked working directory from disk. The branch and its commits stay in the repository.'),
      recovery: t('Recreate a worktree from the same branch; uncommitted files in the removed directory are not recoverable.'),
      confirmLabel: t('Remove worktree'),
      danger: true,
    });
    if (!ok) return;
    setError('');
    setBusy(w.path);
    try {
      const res = await removeWorktree(repo, w.path);
      apply(res.worktrees);
      toast(t('Worktree removed'), 'success');
    } catch (err) {
      if (errorStatus(err) === 409 && /uncommitted changes/i.test(errorMessage(err))) {
        const force = await confirm({
          title: tp('Remove {name} with uncommitted changes?', { name: w.branch || w.path }),
          detail: w.path,
          impact: t('Deletes the linked directory and discards every uncommitted file and modification in it.'),
          recovery: t('Git cannot restore uncommitted changes. Only a filesystem backup can recover them.'),
          confirmLabel: t('Remove with changes'),
          danger: true,
        });
        if (force) {
          try {
            const forced = await removeWorktree(repo, w.path, true);
            apply(forced.worktrees);
            toast(t('Worktree removed'), 'success');
          } catch (forceErr) {
            setError(errorMessage(forceErr) || t('Unable to remove the worktree'));
          }
        }
      } else {
        setError(errorMessage(err) || t('Unable to remove the worktree'));
      }
    } finally {
      setBusy(null);
    }
  }

  async function prune() {
    const ok = await confirm({
      title: t('Prune stale worktrees?'),
      impact: tp('Removes Git metadata for {count} linked worktree(s) whose directories are missing.', { count: prunable }),
      recovery: t('No files are deleted. A missing directory must be restored from a backup or recreated; a live directory can be re-added as a worktree.'),
      confirmLabel: t('Prune'),
    });
    if (!ok) return;
    setError('');
    setBusy('prune');
    try {
      const res = await pruneWorktrees(repo);
      apply(res.worktrees);
      toast(tp('Pruned {count} worktree(s)', { count: res.removed }), 'success');
    } catch (err) {
      setError(errorMessage(err) || t('Unable to prune worktrees'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" style={{ width: 680 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t('Worktrees')}</h2>
          <button type="button" className="icon-btn" aria-label={t('Close')} onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <p className="config-hint">
            {t('Linked worktrees share one repository and keep separate working directories. Create one per parallel task, then lock it to protect it from pruning.')}
          </p>
          {error && <div className="worktree-error">{error}</div>}
          <div className="worktree-list">
            {linked.length === 0 && <div className="worktree-empty">{t('No linked worktrees')}</div>}
            {linked.map((w) => (
              <div key={w.path} className="worktree-row">
                <div className="worktree-info">
                  <div className="worktree-title">
                    <span>{w.branch || t('Detached HEAD')}</span>
                    {w.current && <span className="wt-badge">{t('Current')}</span>}
                    {w.locked && <span className="wt-badge">{t('Locked')}</span>}
                    {w.prunable && <span className="wt-badge wt-badge-warn">{t('Prunable')}</span>}
                  </div>
                  <div className="worktree-path">{w.path}</div>
                  {w.lockReason && <div className="worktree-note">{w.lockReason}</div>}
                  {w.pruneReason && <div className="worktree-note">{w.pruneReason}</div>}
                </div>
                <div className="worktree-actions">
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={busy !== null || w.prunable}
                    onClick={() => (w.locked ? unlock(w) : lock(w))}
                  >
                    {w.locked ? t('Unlock') : t('Lock')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-small btn-danger"
                    disabled={busy !== null || w.current || w.prunable}
                    onClick={() => remove(w)}
                  >
                    {t('Remove')}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="worktree-section">
            <div className="worktree-section-head">
              <strong>{t('New linked worktree')}</strong>
              <button
                type="button"
                className="btn btn-small"
                disabled={busy !== null || prunable === 0}
                onClick={prune}
              >
                {tp('Prune stale ({count})', { count: prunable })}
              </button>
            </div>
            <form onSubmit={create}>
              <div className="form-group">
                <label>{t('Directory')}</label>
                <input
                  value={pathInput}
                  onChange={(e) => setPathInput(e.target.value)}
                  placeholder={`/Users/you/code/${repoName}-task`}
                  autoFocus
                />
                <div className="hint">{t('Use an absolute path outside every registered worktree. The directory must not already contain files.')}</div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>{t('Branch')}</label>
                  <input
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    placeholder="task/my-task"
                  />
                </div>
                <div className="form-group" style={{ flex: '0 0 180px' }}>
                  <label>&nbsp;</label>
                  <label className="checkbox-row" style={{ marginBottom: 0 }}>
                    <input
                      type="checkbox"
                      checked={createBranch}
                      onChange={(e) => setCreateBranch(e.target.checked)}
                    />
                    {t('Create a new branch')}
                  </label>
                </div>
              </div>
              {!createBranch && <div className="hint">{t('The branch must already exist and must not be checked out by another worktree.')}</div>}
              <div className="modal-footer" style={{ padding: '8px 0 0', border: 0 }}>
                <button type="button" className="btn" onClick={onClose}>{t('Close')}</button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={busy !== null || !pathInput.trim() || !branch.trim()}
                >
                  {busy === 'create' ? t('Creating…') : t('Add worktree')}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
