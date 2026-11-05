import { useEffect, useState } from 'react';
import {
  getBlame,
  getFile,
  type BlameResult,
  type FileContent,
} from '../api';
import { useApp } from '../app-state';
import { shortHash } from '../lib/format';
import { IconX } from './icons';

type Mode = 'content' | 'blame';

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
  const [file, setFile] = useState<FileContent | null>(null);
  const [blame, setBlame] = useState<BlameResult | null>(null);
  const [blameLoading, setBlameLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getFile(repo, filePath, rev || undefined)
      .then((res) => { if (!cancelled) setFile(res); })
      .catch((err) => { if (!cancelled) toast(err.message, 'error'); });
    return () => { cancelled = true; };
  }, [repo, filePath, rev, toast]);

  async function switchMode(next: Mode) {
    setMode(next);
    if (next === 'blame' && !blame && !blameLoading) {
      setBlameLoading(true);
      try {
        setBlame(await getBlame(repo, filePath, rev || undefined));
      } catch (err: any) {
        toast(err.message, 'error');
        setMode('content');
      } finally {
        setBlameLoading(false);
      }
    }
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
          <h2>{rev ? `${shortHash(rev)} — ` : ''}{filePath}</h2>
          <button type="button" className="icon-btn" onClick={onClose}><IconX /></button>
        </div>
        <div className="diff-pane" style={{ flex: 1, minHeight: 0 }}>
          <div className="diff-toolbar">
            <span className="file-name">{filePath}</span>
            <span className="view-toggle">
              <button
                type="button"
                className={mode === 'content' ? 'active' : ''}
                onClick={() => switchMode('content')}
              >
                Content
              </button>
              <button
                type="button"
                className={mode === 'blame' ? 'active' : ''}
                onClick={() => switchMode('blame')}
              >
                Blame
              </button>
            </span>
          </div>

          {!file ? (
            <div className="diff-empty">Loading…</div>
          ) : file.masked ? (
            <div className="diff-empty">{filePath} is sensitive — its contents are masked.</div>
          ) : file.binary ? (
            <div className="diff-empty">Binary file — preview not available.</div>
          ) : mode === 'content' ? (
            <pre className="diff">
              {contentLines.map((text, i) => (
                <div key={i} className="file-line">
                  <span className="diff-gutter">{i + 1}</span>
                  <span className="file-content">{text || ' '}</span>
                </div>
              ))}
              {file.truncated && <div className="diff-empty">Preview truncated at 1 MB.</div>}
            </pre>
          ) : (
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
          )}
        </div>
      </div>
    </div>
  );
}
