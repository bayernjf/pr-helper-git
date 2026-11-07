import { useEffect, useRef, useState } from 'react';
import { getCommitDiff, getCommitFiles, type CommitFile } from '../api';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import { useResizable } from '../hooks/use-resizable';
import { formatFullDate, shortHash } from '../lib/format';
import type { DiffResult } from '../types';
import DiffView from './DiffView';
import FileViewer from './FileViewer';
import { IconCopy, IconEye, IconFile, IconX } from './icons';

function statusColor(status: string): string {
  if (status.startsWith('A')) return 'var(--green)';
  if (status.startsWith('D')) return 'var(--red)';
  if (status.startsWith('R') || status.startsWith('C')) return 'var(--cyan)';
  return 'var(--yellow)';
}

export default function CommitDetail() {
  const { commits, selectedHash, selectCommit, activeRepo, toast } = useApp();
  const commit = commits.find((c) => c.hash === selectedHash);
  const [files, setFiles] = useState<CommitFile[]>([]);
  const [patch, setPatch] = useState<DiffResult | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const { widthStyle: detailStyle, separatorProps: detailSeparator } = useResizable({
    prefKey: 'detailWidth',
    initial: 320,
    min: 240,
    max: 560,
    edge: 'left',
    label: 'Resize commit detail panel',
  });

  useEscape(() => closePatch(), !!patch);

  function closePatch() {
    // Invalidate any patch request still in flight so it cannot reopen the
    // dialog after the user closed it.
    patchSeq.current += 1;
    setPatch(null);
  }

  async function copyHash() {
    if (!commit) return;
    try {
      await navigator.clipboard.writeText(commit.hash);
      toast('Commit hash copied', 'success');
    } catch {
      toast('Unable to copy to clipboard', 'error');
    }
  }

  // Depend on the selected hash rather than the commit object: a background
  // SSE refresh recreates the commit array (new object identities) but keeps
  // the same hash, so the open modal and file list must not be reset.
  const patchSeq = useRef(0);
  useEffect(() => {
    let cancelled = false;
    setFiles([]);
    setPatch(null);
    if (!selectedHash || !activeRepo) return;
    getCommitFiles(activeRepo, selectedHash)
      .then((res) => { if (!cancelled) setFiles(res.files); })
      .catch(() => { if (!cancelled) setFiles([]); });
    return () => { cancelled = true; };
  }, [selectedHash, activeRepo]);

  async function openPatch(file: CommitFile) {
    if (!commit || !activeRepo) return;
    // Ignore a stale response when the user clicks another file meanwhile.
    const seq = ++patchSeq.current;
    try {
      const result = await getCommitDiff(activeRepo, commit.hash, file.path);
      if (seq === patchSeq.current) setPatch(result);
    } catch (err: any) {
      if (seq !== patchSeq.current) return;
      setPatch(null);
      toast(err?.detail ? `${err.message}: ${err.detail}` : err?.message || 'cannot load patch', 'error');
    }
  }

  if (!commit) {
    return (
      <aside className="detail" style={detailStyle}>
        <button type="button" className="col-resize" {...detailSeparator} />
        <div className="diff-empty">Select a commit in the graph to inspect its metadata.</div>
      </aside>
    );
  }

  return (
    <aside className="detail" style={detailStyle}>
      <button type="button" className="col-resize" {...detailSeparator} />
      <h3>{commit.subject}</h3>

      <div className="detail-section">
        <span className="detail-label">Commit</span>
        <div className="detail-value hash-row">
          <span className="hash-text">{commit.hash}</span>
          <button type="button" className="icon-btn" title="Copy full hash" onClick={copyHash}>
            <IconCopy width={14} height={14} />
          </button>
        </div>
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
        <div className="modal-backdrop" onClick={closePatch}>
          <div
            className="modal"
            style={{ width: '86vw', height: '82vh', display: 'flex', flexDirection: 'column' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>{shortHash(commit.hash)} — {patch.path}</h2>
              <button type="button" className="icon-btn" aria-label="Close patch" title="Close patch" onClick={closePatch}>
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
