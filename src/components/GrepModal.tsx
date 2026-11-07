import { useMemo, useRef, useState } from 'react';
import { searchGrep, type GrepMatch } from '../api';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import { IconSearch, IconX } from './icons';

export default function GrepModal({ onClose }: { onClose: () => void }) {
  const { activeRepo, toast } = useApp();
  const [pattern, setPattern] = useState('');
  const [path, setPath] = useState('');
  const [matches, setMatches] = useState<GrepMatch[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const seqRef = useRef(0);
  useEscape(onClose);

  async function runSearch(event?: React.FormEvent) {
    event?.preventDefault();
    const term = pattern.trim();
    if (!term || !activeRepo) return;
    const seq = ++seqRef.current;
    setLoading(true);
    try {
      const res = await searchGrep(activeRepo, term, path.trim() || undefined);
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
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Search repository contents</h2>
          <button type="button" className="icon-btn" aria-label="Close" title="Close" onClick={onClose}><IconX /></button>
        </div>
        <form className="grep-form" onSubmit={runSearch}>
          <div className="grep-input">
            <IconSearch width={14} height={14} />
            <input
              autoFocus
              placeholder="Search text or regex…"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
            />
          </div>
          <div className="grep-input">
            <input
              placeholder="Path filter (optional), e.g. src/"
              value={path}
              onChange={(e) => setPath(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={!pattern.trim() || loading}>
            Search
          </button>
        </form>
        <div className="modal-body no-pad grep-body">
          {loading ? (
            <div className="list-empty">Searching…</div>
          ) : !searched ? (
            <div className="list-empty">Enter a term to search tracked and untracked files.</div>
          ) : matches.length === 0 ? (
            <div className="list-empty">No matches.</div>
          ) : (
            <div className="grep-results">
              {grouped.map(([file, items]) => (
                <div className="grep-file" key={file}>
                  <div className="grep-file-head">{file}</div>
                  {items.map((m) => (
                    <div className="grep-line" key={`${m.path}-${m.line}`}>
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
          <span className="grep-count">{searched ? `${matches.length} matches` : ''}</span>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
