import { useEffect, useState } from 'react';
import {
  getBlame,
  getFile,
  getFileHistory,
  type BlameResult,
  type FileContent,
} from '../api';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import { formatRelative, shortHash } from '../lib/format';
import type { Commit } from '../types';
import { IconX } from './icons';

type Mode = 'content' | 'blame' | 'history';

export default function FileViewer({
  repo,
  filePath,
  rev,
  onClose,
}: {
  repo: string;
  filePath: string;
  rev?: string | null;
  onClose: () => void;
}) {
  const { toast } = useApp();
  const [mode, setMode] = useState<Mode>('content');
  const [viewRev, setViewRev] = useState<string | null>(null);
  const effectiveRev = viewRev ?? rev ?? null;
  const [file, setFile] = useState<FileContent | null>(null);
  const [blame, setBlame] = useState<BlameResult | null>(null);
  const [blameLoading, setBlameLoading] = useState(false);
  const [history, setHistory] = useState<Commit[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEscape(onClose);

  // Load the blob contents whenever the viewed revision changes.
  useEffect(() => {
    let cancelled = false;
    setFile(null);
    getFile(repo, filePath, effectiveRev || undefined)
      .then((res) => { if (!cancelled) setFile(res); })
      .catch((err) => { if (!cancelled) toast(err.message, 'error'); });
    return () => { cancelled = true; };
  }, [repo, filePath, effectiveRev, toast]);

  // Reload blame automatically when in blame mode or the revision changes.
  useEffect(() => {
    if (mode !== 'blame') return;
    let cancelled = false;
    setBlameLoading(true);
    setBlame(null);
    getBlame(repo, filePath, effectiveRev || undefined)
      .then((res) => { if (!cancelled) setBlame(res); })
      .catch((err) => { if (!cancelled) toast(err.message, 'error'); })
      .finally(() => { if (!cancelled) setBlameLoading(false); });
    return () => { cancelled = true; };
  }, [mode, repo, filePath, effectiveRev, toast]);

  // Load the file history whenever the history tab is active.
  useEffect(() => {
    if (mode !== 'history') return;
    let cancelled = false;
    setHistoryLoading(true);
    setHistory(null);
    getFileHistory(repo, filePath)
      .then((res) => { if (!cancelled) setHistory(res.commits); })
      .catch((err) => { if (!cancelled) toast(err.message, 'error'); })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [mode, repo, filePath, toast]);

  function pickHistory(commit: Commit) {
    setViewRev(commit.hash);
    setMode('content');
  }

  const contentLines = file?.content ? file.content.split('\n') : [];
  if (contentLines.length && contentLines[contentLines.length - 1] === '') contentLines.pop();

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="modal"
        style={{ width: '86vw', height: '82vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{effectiveRev ? `${shortHash(effectiveRev)} — ` : ''}{filePath}</h2>
          <button type="button" className="icon-btn" onClick={onClose}><IconX /></button>
        </div>
        <div className="diff-pane" style={{ flex: 1, minHeight: 0 }}>
          <div className="diff-toolbar">
            <span className="file-name">{filePath}</span>
            <span className="view-toggle">
              <button type="button" className={mode === 'content' ? 'active' : ''} onClick={() => setMode('content')}>
                Content
              </button>
              <button type="button" className={mode === 'blame' ? 'active' : ''} onClick={() => setMode('blame')}>
                Blame
              </button>
              <button type="button" className={mode === 'history' ? 'active' : ''} onClick={() => setMode('history')}>
                History
              </button>
            </span>
          </div>

          {!file && mode !== 'history' ? (
            <div className="diff-empty">Loading…</div>
          ) : file?.masked && mode !== 'history' ? (
            <div className="diff-empty">{filePath} is sensitive — its contents are masked.</div>
          ) : file?.binary && mode !== 'history' ? (
            <div className="diff-empty">Binary file — preview not available.</div>
          ) : mode === 'history' ? (
            <div className="file-history">
              {historyLoading || !history ? (
                <div className="diff-empty">Loading history…</div>
              ) : history.length === 0 ? (
                <div className="diff-empty">No history found for this file.</div>
              ) : (
                history.map((c) => (
                  <button key={c.hash} type="button" className="history-item" onClick={() => pickHistory(c)}>
                    <span className="history-sha">{shortHash(c.hash)}</span>
                    <span className="history-msg">{c.subject}</span>
                    <span className="history-author">{c.authorName}</span>
                    <span className="history-date">{formatRelative(c.date)}</span>
                  </button>
                ))
              )}
            </div>
          ) : mode === 'blame' ? (
            <pre className="diff">
              {blameLoading || !blame ? (
                <div className="diff-empty">Loading blame…</div>
              ) : (
                blame.lines.map((b) => (
                  <div key={b.line} className="blame-line">
                    <span className="diff-gutter">{b.line}</span>
                    <span className="blame-meta">
                      <span className="blame-author">{b.author}</span>
                      <span className="blame-sha">{shortHash(b.sha)}</span>
                    </span>
                    <span className="file-content">{b.text || ' '}</span>
                  </div>
                ))
              )}
            </pre>
          ) : (
            <pre className="diff">
              {contentLines.map((text, i) => (
                <div key={i} className="file-line">
                  <span className="diff-gutter">{i + 1}</span>
                  <span className="file-content">{text || ' '}</span>
                </div>
              ))}
              {file?.truncated && <div className="diff-empty">Preview truncated at 1 MB.</div>}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
