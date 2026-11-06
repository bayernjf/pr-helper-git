import { useEffect, useState } from 'react';
import {
  ApiError,
  getBlame,
  getFile,
  getFileHistory,
  saveFile,
  type BlameResult,
  type FileContent,
} from '../api';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import { formatRelative, shortHash } from '../lib/format';
import type { Commit } from '../types';
import { IconX } from './icons';

type Mode = 'content' | 'blame' | 'history' | 'edit';

export default function FileViewer({
  repo,
  filePath,
  rev,
  initialMode = 'content',
  onClose,
}: {
  repo: string;
  filePath: string;
  rev?: string | null;
  initialMode?: Mode;
  onClose: () => void;
}) {
  const { toast } = useApp();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [viewRev, setViewRev] = useState<string | null>(null);
  const effectiveRev = viewRev ?? rev ?? null;
  const [file, setFile] = useState<FileContent | null>(null);
  const [blame, setBlame] = useState<BlameResult | null>(null);
  const [blameLoading, setBlameLoading] = useState(false);
  const [history, setHistory] = useState<Commit[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEscape(onClose);

  // Editing is only allowed for the working tree (no pinned revision) on a
  // regular text file that is neither masked, binary nor truncated.
  const canEdit = !effectiveRev && !!file && !file.masked && !file.binary && !file.truncated;

  function startEdit() {
    if (!file) return;
    setDraft(file.content);
    setMode('edit');
  }

  function cancelEdit() {
    setMode('content');
    setDraft('');
  }

  async function submitEdit() {
    if (saving) return;
    setSaving(true);
    try {
      // mtime is the optimistic-concurrency token; null only for a working
      // tree blob that could not be stat'd (ref views never reach edit mode).
      await saveFile(repo, filePath, draft, file?.mtimeMs ?? null);
      toast('File saved', 'success');
      setMode('content');
      setDraft('');
      // Reload the blob so line numbers and the watcher-driven view stay in sync.
      setFile(await getFile(repo, filePath));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast('File changed on disk — reload the latest version before saving', 'error');
        // Refresh the underlying blob so the user can compare against the
        // new content; the draft is kept so their edits are not destroyed.
        setFile(await getFile(repo, filePath));
      } else {
        toast(err instanceof Error ? err.message : 'save failed', 'error');
      }
    } finally {
      setSaving(false);
    }
  }

  // Editor keyboard: Cmd/Ctrl+S saves without leaving the textarea, Tab inserts
  // indentation (Shift+Tab removes it) instead of moving focus away.
  function handleEditorKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void submitEdit();
      return;
    }
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const el = e.currentTarget;
    const { selectionStart: start, selectionEnd: end, value } = el;
    if (e.shiftKey) {
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const lineHead = value.slice(lineStart, start);
      const match = lineHead.match(/^( {1,2}|\t)/);
      if (!match) return;
      const next = value.slice(0, lineStart) + lineHead.slice(match[0].length) + value.slice(start);
      setDraft(next);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start - match[0].length;
      });
    } else {
      const insert = '  ';
      const next = value.slice(0, start) + insert + value.slice(end);
      setDraft(next);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + insert.length;
      });
    }
  }

  // Load the blob contents whenever the viewed revision changes.
  useEffect(() => {
    let cancelled = false;
    setFile(null);
    getFile(repo, filePath, effectiveRev || undefined)
      .then((res) => { if (!cancelled) setFile(res); })
      .catch((err) => { if (!cancelled) toast(err.message, 'error'); });
    return () => { cancelled = true; };
  }, [repo, filePath, effectiveRev, toast]);

  // When opened straight into edit mode, seed the draft from the loaded blob.
  useEffect(() => {
    if (initialMode === 'edit' && file && !draft) setDraft(file.content);
  }, [initialMode, file, draft]);

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
              {canEdit && (
                <button
                  type="button"
                  className={mode === 'edit' ? 'active' : ''}
                  title="Edit working-tree file"
                  onClick={startEdit}
                >
                  Edit
                </button>
              )}
            </span>
          </div>

          {!file && mode !== 'history' ? (
            <div className="diff-empty">Loading…</div>
          ) : file?.masked && mode !== 'history' ? (
            <div className="diff-empty">{filePath} is sensitive — its contents are masked.</div>
          ) : file?.binary && mode !== 'history' ? (
            <div className="diff-empty">Binary file — preview not available.</div>
          ) : mode === 'edit' ? (
            <div className="file-editor">
              <textarea
                value={draft}
                spellCheck={false}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleEditorKeyDown}
              />
              <div className="file-editor-actions">
                <span className="editor-hint">Tab to indent · Cmd/Ctrl+S to save</span>
                <button type="button" className="btn" onClick={cancelEdit} disabled={saving}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={submitEdit}
                  disabled={saving}
                  title="Save (Cmd/Ctrl+S)"
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
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
