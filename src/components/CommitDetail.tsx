import { useEffect, useState } from 'react';
import { getCommitDiff, getCommitFiles, type CommitFile } from '../api';
import { useApp } from '../app-state';
import { formatFullDate, shortHash } from '../lib/format';
import type { DiffResult } from '../types';
import DiffView from './DiffView';
import FileViewer from './FileViewer';
import { IconEye, IconFile, IconX } from './icons';

function statusColor(status: string): string {
  if (status.startsWith('A')) return 'var(--green)';
  if (status.startsWith('D')) return 'var(--red)';
  if (status.startsWith('R') || status.startsWith('C')) return 'var(--cyan)';
  return 'var(--yellow)';
}

export default function CommitDetail() {
  const { commits, selectedHash, selectCommit, activeRepo } = useApp();
  const commit = commits.find((c) => c.hash === selectedHash);
  const [files, setFiles] = useState<CommitFile[]>([]);
  const [patch, setPatch] = useState<DiffResult | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);

  useEffect(() => {
    setFiles([]);
    setPatch(null);
    if (!commit || !activeRepo) return;
    getCommitFiles(activeRepo, commit.hash)
      .then((res) => setFiles(res.files))
      .catch(() => setFiles([]));
  }, [commit, activeRepo]);

  async function openPatch(file: CommitFile) {
    if (!commit || !activeRepo) return;
    try {
      const result = await getCommitDiff(activeRepo, commit.hash, file.path);
      setPatch(result);
    } catch {
      setPatch(null);
    }
  }

  if (!commit) {
    return (
      <aside className="detail">
        <div className="diff-empty">Select a commit in the graph to inspect its metadata.</div>
      </aside>
    );
  }

  return (
    <aside className="detail">
      <h3>{commit.subject}</h3>

      <div className="detail-section">
        <span className="detail-label">Commit</span>
        <div className="detail-value">{commit.hash}</div>
      </div>

      <div className="detail-section">
        <span className="detail-label">Author</span>
        <div className="detail-value muted">
          <span className="author-line">
            <span className="detail-avatar">{commit.authorName.slice(0, 1).toUpperCase()}</span>
            {commit.authorName}
          </span>
        </div>
      </div>

      <div className="detail-section">
        <span className="detail-label">Date</span>
        <div className="detail-value muted">{formatFullDate(commit.date)}</div>
      </div>

      {commit.parents.length > 0 && (
        <div className="detail-section">
          <span className="detail-label">Parents</span>
          {commit.parents.map((p) => (
            <button key={p} type="button" className="parent-link" onClick={() => selectCommit(p)}>
              {shortHash(p)}
            </button>
          ))}
        </div>
      )}

      {commit.body && (
        <div className="detail-section">
          <span className="detail-label">Message body</span>
          <div className="detail-body">{commit.body}</div>
        </div>
      )}

      <div className="detail-section">
        <span className="detail-label">Changed files ({files.length})</span>
        <div className="pr-detail-list">
          {files.map((f) => (
            <button
              key={f.path}
              type="button"
              className="pr-detail-item"
              style={{ width: '100%', textAlign: 'left' }}
              onClick={() => openPatch(f)}
              title="View patch"
            >
              <span style={{ color: statusColor(f.status), width: 16 }}>{f.status.slice(0, 1)}</span>
              <IconFile width={13} height={13} style={{ color: 'var(--faint)' }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.path}</span>
              <span
                role="button"
                title="View file at this commit"
                style={{ display: 'inline-flex', padding: '0 4px', cursor: 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation();
                  setViewer(f.path);
                }}
              >
                <IconEye width={13} height={13} />
              </span>
              <span className="changes-stats">
                <span className="add">+{f.additions}</span>
                <span className="del">-{f.deletions}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {patch && (
        <div className="modal-backdrop" onClick={() => setPatch(null)}>
          <div
            className="modal"
            style={{ width: '86vw', height: '82vh', display: 'flex', flexDirection: 'column' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>{shortHash(commit.hash)} — {patch.path}</h2>
              <button type="button" className="icon-btn" onClick={() => setPatch(null)}>
                <IconX />
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <DiffView result={patch} />
            </div>
          </div>
        </div>
      )}

      {viewer && activeRepo && (
        <FileViewer
          repo={activeRepo}
          filePath={viewer}
          rev={commit.hash}
          onClose={() => setViewer(null)}
        />
      )}
    </aside>
  );
}
