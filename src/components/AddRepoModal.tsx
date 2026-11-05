import { useState } from 'react';
import { addRepo, cloneRepo, initRepo } from '../api';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import {
  IconDownload,
  IconFolder,
  IconPlus,
  IconX,
} from './icons';

type Mode = 'open' | 'clone' | 'init';

const DEFAULT_PARENT = '/Users/jiangfeng/000mycodes';

// Derive a folder name from a clone URL: strip a trailing .git and take the
// last path component.
function suggestName(url: string): string {
  const trimmed = url.trim().replace(/\/$/, '');
  const colon = trimmed.lastIndexOf(':');
  const slash = trimmed.lastIndexOf('/');
  const last = trimmed.slice(Math.max(colon, slash) + 1);
  return last.replace(/\.git$/, '');
}

const MODES: Array<{ id: Mode; label: string; icon: React.ReactNode }> = [
  { id: 'open', label: 'Open', icon: <IconFolder width={14} height={14} /> },
  { id: 'clone', label: 'Clone', icon: <IconDownload width={14} height={14} /> },
  { id: 'init', label: 'Init', icon: <IconPlus width={14} height={14} /> },
];

export default function AddRepoModal({ onClose }: { onClose: () => void }) {
  const { selectRepo, refreshRepos, toast } = useApp();
  useEscape(onClose);
  const [mode, setMode] = useState<Mode>('open');
  const [saving, setSaving] = useState(false);

  const [localPath, setLocalPath] = useState('');
  const [url, setUrl] = useState('');
  const [parentDir, setParentDir] = useState(DEFAULT_PARENT);
  const [name, setName] = useState('');
  const [initName, setInitName] = useState('');

  async function adopt(returnedPath: string) {
    const updated = await refreshRepos();
    const match = updated.find((r) => r.path === returnedPath)
      || updated.find((r) => r.path === localPath)
      || updated[updated.length - 1];
    if (match) selectRepo(match.path);
    onClose();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      if (mode === 'open') {
        const target = localPath.trim();
        if (!target) return;
        await addRepo(target);
        await adopt(target);
      } else if (mode === 'clone') {
        const source = url.trim();
        const folder = name.trim() || suggestName(source);
        if (!source || !folder) return;
        const res = await cloneRepo(source, parentDir.trim(), folder);
        await adopt(res.path);
      } else {
        const folder = initName.trim();
        if (!folder) return;
        const full = `${parentDir.trim().replace(/\/$/, '')}/${folder}`;
        const res = initRepo(full);
        await adopt((await res).path);
      }
    } catch (err: any) {
      toast(err.detail ? `${err.message}: ${err.detail}` : err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  const canSubmit = mode === 'open'
    ? !!localPath.trim()
    : mode === 'clone'
      ? !!url.trim() && !!parentDir.trim()
      : !!initName.trim() && !!parentDir.trim();

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <form className="modal" style={{ width: 540 }} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-header">
          <h2>Add a repository</h2>
          <button type="button" className="icon-btn" onClick={onClose}><IconX /></button>
        </div>

        <div className="modal-body">
          <div className="repo-mode-tabs">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`repo-mode-tab${mode === m.id ? ' active' : ''}`}
                onClick={() => setMode(m.id)}
              >
                {m.icon}
                {m.label}
              </button>
            ))}
          </div>

          {mode === 'open' && (
            <div className="form-group">
              <label>Repository path</label>
              <input
                autoFocus
                placeholder="/Users/you/000mycodes/some-repo"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
              />
              <div className="hint">Absolute path of a folder that already contains a .git directory.</div>
            </div>
          )}

          {mode === 'clone' && (
            <>
              <div className="form-group">
                <label>Remote URL</label>
                <input
                  autoFocus
                  placeholder="https://github.com/you/repo.git or git@github.com:you/repo.git"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
                <div className="hint">Only network transports (https, ssh, git) are accepted.</div>
              </div>
              <div className="form-group">
                <label>Parent directory</label>
                <input value={parentDir} onChange={(e) => setParentDir(e.target.value)} />
              </div>
              <div className="form-group">
                <label>New folder name</label>
                <input
                  placeholder={suggestName(url) || 'repository name'}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            </>
          )}

          {mode === 'init' && (
            <>
              <div className="form-group">
                <label>Parent directory</label>
                <input value={parentDir} onChange={(e) => setParentDir(e.target.value)} />
              </div>
              <div className="form-group">
                <label>New folder name</label>
                <input
                  autoFocus
                  placeholder="brand-new-project"
                  value={initName}
                  onChange={(e) => setInitName(e.target.value)}
                />
                <div className="hint">The folder is created if needed, then git init runs inside it.</div>
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving || !canSubmit}>
            {saving ? 'Working…' : mode === 'clone' ? 'Clone repository' : 'Add repository'}
          </button>
        </div>
      </form>
    </div>
  );
}
