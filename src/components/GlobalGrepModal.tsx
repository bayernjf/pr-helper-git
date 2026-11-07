import { useMemo, useState } from 'react';
import { searchAllGrep, type GrepRepoResult } from '../api';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import { IconSearch, IconX } from './icons';

export default function GlobalGrepModal({ onClose }: { onClose: () => void }) {
  const { toast } = useApp();
  const [pattern, setPattern] = useState('');
  const [results, setResults] = useState<GrepRepoResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  useEscape(onClose);

  async function runSearch(event?: React.FormEvent) {
    event?.preventDefault();
    const term = pattern.trim();
    if (!term) return;
    setLoading(true);
    try {
      const res = await searchAllGrep(term);
      setResults(res.results);
      setSearched(true);
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  const total = useMemo(
    () => results.reduce((sum, r) => sum + r.matches.length, 0),
    [results],
  );

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Search across all repositories</h2>
          <button type="button" className="icon-btn" onClick={onClose}><IconX /></button>
        </div>
        <form className="grep-form" onSubmit={runSearch}>
          <div className="grep-input">
            <IconSearch width={14} height={14} />
            <input
              autoFocus
              placeholder="Search text or regex in every registered repo…"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={!pattern.trim() || loading}>
            Search all
          </button>
        </form>
        <div className="modal-body no-pad grep-body">
          {loading ? (
            <div className="list-empty">Searching all repositories…</div>
          ) : !searched ? (
            <div className="list-empty">Enter a term to search tracked and untracked files across every repo.</div>
          ) : total === 0 ? (
            <div className="list-empty">No matches in any repository.</div>
          ) : (
            <div className="grep-results">
              {results.map((repo) => (
                <div className="grep-repo" key={repo.repo}>
                  <div className="grep-repo-head">
                    {repo.name}
                    <span className="grep-repo-path">{repo.repo}</span>
                    {repo.error && <span className="grep-repo-error">unavailable: {repo.error}</span>}
                  </div>
                  {groupFiles(repo.matches).map(([file, items]) => (
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
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <span className="grep-count">
            {searched ? `${total} matches across ${results.length} repos` : ''}
          </span>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function groupFiles(matches: GrepRepoResult['matches']): [string, typeof matches][] {
  const map = new Map<string, GrepRepoResult['matches']>();
  for (const m of matches) {
    const list = map.get(m.path) || [];
    list.push(m);
    map.set(m.path, list);
  }
  return [...map.entries()];
}
