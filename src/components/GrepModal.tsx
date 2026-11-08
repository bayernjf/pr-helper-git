import { useMemo, useRef, useState } from 'react';
import { searchGrep, type GrepMatch } from '../api';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import FileViewer from './FileViewer';
import { IconSearch, IconX } from './icons';
import { t } from '../i18n';

export default function GrepModal({ onClose }: { onClose: () => void }) {
  const { activeRepo, toast } = useApp();
  const [pattern, setPattern] = useState('');
  const [path, setPath] = useState('');
  const [glob, setGlob] = useState('');
  const [ignoreCase, setIgnoreCase] = useState(false);
  const [matches, setMatches] = useState<GrepMatch[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [openMatch, setOpenMatch] = useState<{ path: string; line: number } | null>(null);
  const seqRef = useRef(0);
  useEscape(onClose);

  function openResult(file: string, line: number) {
    if (!activeRepo) return;
    setOpenMatch({ path: file, line });
  }

  async function runSearch(event?: React.FormEvent) {
    event?.preventDefault();
    const term = pattern.trim();
    if (!term || !activeRepo) return;
    const seq = ++seqRef.current;
    setLoading(true);
    try {
      const res = await searchGrep(activeRepo, term, path.trim() || undefined, {
        ignoreCase,
        glob: glob.trim() || undefined,
      });
      // A second search may have been started while this one was in flight.
      if (seq !== seqRef.current) return;
      setMatches(res.matches);
      setSearched(true);
    } catch (err: any) {
      if (seq === seqRef.current) toast(err.message, 'error');
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }

  // Group matches by file while preserving the command output order.
  const grouped = useMemo(() => {
    const map = new Map<string, GrepMatch[]>();
    for (const m of matches) {
      const list = map.get(m.path) || [];
      list.push(m);
      map.set(m.path, list);
    }
    return [...map.entries()];
  }, [matches]);

  return (
    <>
      <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
        <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t("Search repository contents")}</h2>
          <button type="button" className="icon-btn" aria-label={t("Close")} title={t("Close")} onClick={onClose}><IconX /></button>
        </div>
        <form className="grep-form" onSubmit={runSearch}>
          <div className="grep-input">
            <IconSearch width={14} height={14} />
            <input
              autoFocus
              placeholder={t("Search text or regex…")}
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
            />
          </div>
          <div className="grep-input">
            <input
              placeholder={t("Path filter (optional), e.g. src/")}
              value={path}
              onChange={(e) => setPath(e.target.value)}
            />
          </div>
          <div className="grep-input">
            <input
              placeholder={t("File glob (optional), e.g. *.ts")}
              value={glob}
              onChange={(e) => setGlob(e.target.value)}
            />
          </div>
          <label className="grep-case" title={t("Ignore case (git grep -i)")}>
            <input
              type="checkbox"
              checked={ignoreCase}
              onChange={(e) => setIgnoreCase(e.target.checked)}
            />
            Ignore case
          </label>
          <button type="submit" className="btn btn-primary" disabled={!pattern.trim() || loading}>
            Search
          </button>
        </form>
        <div className="modal-body no-pad grep-body">
          {loading ? (
            <div className="list-empty">{t("Searching…")}</div>
          ) : !searched ? (
            <div className="list-empty">{t("Enter a term to search tracked and untracked files.")}</div>
          ) : matches.length === 0 ? (
            <div className="list-empty">{t("No matches.")}</div>
          ) : (
            <div className="grep-results">
              {grouped.map(([file, items]) => (
                <div className="grep-file" key={file}>
                  <div className="grep-file-head">{file}</div>
                  {items.map((m) => (
                    <div
                      className="grep-line clickable"
                      key={`${m.path}-${m.line}`}
                      role="button"
                      tabIndex={0}
                      title={t("Open this file at the matching line")}
                      onClick={() => openResult(m.path, m.line)}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return;
                        e.preventDefault();
                        openResult(m.path, m.line);
                      }}
                    >
                      <span className="grep-lineno">{m.line}</span>
                      <span className="grep-text">{m.text}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <span className="grep-count">{searched ? t(`${matches.length} matches`) : ''}</span>
          <button type="button" className="btn" onClick={onClose}>{t("Close")}</button>
        </div>
        </div>
      </div>
      {openMatch && activeRepo && (
        <FileViewer
          repo={activeRepo}
          filePath={openMatch.path}
          initialLine={openMatch.line}
          highlight={pattern.trim()}
          onClose={() => setOpenMatch(null)}
        />
      )}
    </>
  );
}
