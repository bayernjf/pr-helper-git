import { useState } from 'react';
import { resolveConflict } from '../api';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import FileViewer from './FileViewer';
import ConflictEditorModal from './ConflictEditorModal';
import { IconEdit, IconX } from './icons';
import { t } from '../i18n';

// Minimal conflict helper: list the unmerged paths, let the user take one side
// (`git checkout --ours/--theirs` + `git add`) or mark a manually edited file
// resolved. No three-way merge editor by design.
export default function ResolveConflictsModal({
  repo,
  onClose,
}: {
  repo: string;
  onClose: () => void;
}) {
  const { status, runAction } = useApp();
  const [pending, setPending] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  useEscape(onClose);

  const conflicts = status?.files.filter((f) => f.area === 'unmerged') ?? [];

  async function take(path: string, strategy: 'ours' | 'theirs' | 'mark') {
    if (pending) return;
    setPending(path);
    const label = strategy === 'mark'
      ? 'marked resolved'
      : strategy === 'ours' ? 'kept current side' : 'took incoming side';
    await runAction(resolveConflict(repo, path, strategy), `${path} ${label}`);
    setPending(null);
  }

  return (
    <>
      <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
        <div className="modal" style={{ width: '640px' }} onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2>{t("Resolve conflicts")}</h2>
            <button type="button" className="icon-btn" aria-label={t("Close")} title={t("Close")} onClick={onClose}>
              <IconX />
            </button>
          </div>
          <div className="modal-body no-pad">
            {conflicts.length === 0 ? (
              <div className="conflict-empty">
                No conflicted files remain. Continue or commit from the operation banner.
              </div>
            ) : (
              conflicts.map((file) => (
                <div className="conflict-row" key={file.path}>
                  <span className="conflict-path" title={file.path}>{file.path}</span>
                  <button type="button" className="conflict-open" onClick={() => setViewing(file.path)}>
                    View
                  </button>
                  <div className="conflict-actions">
                    <button
                      type="button"
                      className="btn"
                      title={t('Open the three-way merge editor')}
                      onClick={() => setEditing(file.path)}
                    >
                      <IconEdit width={13} height={13} /> {t('Editor')}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={pending === file.path}
                      title="Take the current branch version (git checkout --ours)"
                      onClick={() => take(file.path, 'ours')}
                    >
                      Use current
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={pending === file.path}
                      title="Take the incoming version (git checkout --theirs)"
                      onClick={() => take(file.path, 'theirs')}
                    >
                      Use incoming
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={pending === file.path}
                      title={t("Stage the file after editing it by hand (git add)")}
                      onClick={() => take(file.path, 'mark')}
                    >
                      Mark resolved
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="modal-footer">
            <span className="grep-count">
              {conflicts.length
                ? `${conflicts.length} file${conflicts.length === 1 ? '' : 's'} still conflicted`
                : ''}
            </span>
            <button type="button" className="btn" onClick={onClose}>{t("Close")}</button>
          </div>
        </div>
      </div>
      {viewing && (
        <FileViewer
          repo={repo}
          filePath={viewing}
          onClose={() => setViewing(null)}
        />
      )}
      {editing && (
        <ConflictEditorModal
          repo={repo}
          path={editing}
          onClose={() => setEditing(null)}
          onResolved={() => setEditing(null)}
        />
      )}
    </>
  );
}
