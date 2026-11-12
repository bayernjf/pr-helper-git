import { errorMessage, errorDetail } from '../lib/errors';
import { useState } from 'react';
import { addRepo, cloneRepo, initRepo } from '../api';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import { t } from '../i18n';
import { STORAGE_KEYS } from '../lib/storage-keys';
import {
  IconDownload,
  IconFolder,
  IconPlus,
  IconX,
} from './icons';

type Mode = 'open' | 'clone' | 'init';

const PARENT_KEY = STORAGE_KEYS.cloneParent;

// Start from the last directory the user cloned into, then fall back to the
// parent of the repository already open. Never hard-code a machine-specific
// path: the app also runs on other accounts and platforms.
function initialParentDir(activeRepo: string | null): string {
  const saved = localStorage.getItem(PARENT_KEY);
  if (saved) return saved;
  if (!activeRepo) return '';
  const slash = activeRepo.lastIndexOf('/');
  return slash > 0 ? activeRepo.slice(0, slash) : activeRepo;
}

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

export default function AddRepoModal({
  onClose,
  initialPath = '',
}: {
  onClose: () => void;
  initialPath?: string;
}) {
  const { selectRepo, refreshRepos, toast, activeRepo } = useApp();
  useEscape(onClose);
  const [mode, setMode] = useState<Mode>('open');
  const [saving, setSaving] = useState(false);

  const [localPath, setLocalPath] = useState(initialPath);
  const [url, setUrl] = useState('');
  const [parentDir, setParentDir] = useState(() => initialParentDir(activeRepo));
  const [name, setName] = useState('');
  const [initName, setInitName] = useState('');

  async function adopt(returnedPath?: string) {
    const updated = await refreshRepos();
    const match = (returnedPath ? updated.find((r) => r.path === returnedPath) : undefined)
      || updated.find((r) => r.path === localPath);
    if (match) selectRepo(match.path);
    onClose();
  }

  function rememberParent() {
    const trimmed = parentDir.trim();
    if (trimmed) localStorage.setItem(PARENT_KEY, trimmed);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      if (mode === 'open') {
        const target = localPath.trim();
        if (!target) return;
        const res = await addRepo(target);
        await adopt(res.path);
      } else if (mode === 'clone') {
        const source = url.trim();
        const folder = name.trim() || suggestName(source);
        if (!source || !folder) return;
        const res = await cloneRepo(source, parentDir.trim(), folder);
        rememberParent();
        await adopt(res.path);
      } else {
        const folder = initName.trim();
        if (!folder) return;
        const full = `${parentDir.trim().replace(/\/$/, '')}/${folder}`;
        const res = await initRepo(full);
        rememberParent();
        await adopt(res.path);
      }
    } catch (err) {
      toast(errorDetail(err) ? `${errorMessage(err)}: ${errorDetail(err)}` : errorMessage(err), 'error');
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
          <h2>{t("Add a repository")}</h2>
          <button type="button" className="icon-btn" aria-label={t("Close")} title={t("Close")} onClick={onClose}><IconX /></button>
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
              <label>{t("Repository path")}</label>
              <input
                autoFocus
                placeholder="/Users/you/000mycodes/some-repo"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
              />
              <div className="hint">{t("Absolute path of a folder that already contains a .git directory.")}</div>
            </div>
          )}

          {mode === 'clone' && (
            <>
              <div className="form-group">
                <label>{t("Remote URL")}</label>
                <input
                  autoFocus
                  placeholder="https://github.com/you/repo.git or git@github.com:you/repo.git"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
                <div className="hint">{t("Only network transports (https, ssh, git) are accepted.")}</div>
              </div>
              <div className="form-group">
                <label>{t("Parent directory")}</label>
                <input value={parentDir} onChange={(e) => setParentDir(e.target.value)} />
              </div>
              <div className="form-group">
                <label>{t("New folder name")}</label>
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
                <label>{t("Parent directory")}</label>
                <input value={parentDir} onChange={(e) => setParentDir(e.target.value)} />
              </div>
              <div className="form-group">
                <label>{t("New folder name")}</label>
                <input
                  autoFocus
                  placeholder="brand-new-project"
                  value={initName}
                  onChange={(e) => setInitName(e.target.value)}
                />
                <div className="hint">{t("The folder is created if needed, then git init runs inside it.")}</div>
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>{t("Cancel")}</button>
          <button type="submit" className="btn btn-primary" disabled={saving || !canSubmit}>
            {saving ? 'Working…' : mode === 'clone' ? 'Clone repository' : 'Add repository'}
          </button>
        </div>
      </form>
    </div>
  );
}