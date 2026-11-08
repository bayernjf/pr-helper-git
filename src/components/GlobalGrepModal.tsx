import { useMemo, useState } from 'react';
import { searchAllGrep, type GrepRepoResult } from '../api';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import FileViewer from './FileViewer';
import { IconSearch, IconX } from './icons';
import { t } from '../i18n';

export default function GlobalGrepModal({ onClose }: { onClose: () => void }) {
  const { toast } = useApp();
  const [pattern, setPattern] = useState('');
  const [glob, setGlob] = useState('');
  const [ignoreCase, setIgnoreCase] = useState(false);
  const [results, setResults] = useState<GrepRepoResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [openMatch, setOpenMatch] = useState<{ repo: string; path: string; line: number } | null>(null);
  useEscape(onClose);

  function openResult(repo: string, file: string, line: number) {
    // Open the match in its own repository, whether or not it is the active
    // one: the viewer takes an explicit repo path.
    setOpenMatch({ repo, path: file, line });
  }

  async function runSearch(event?: React.FormEvent) {
    event?.preventDefault();
    const term = pattern.trim();
    if (!term) return;
    setLoading(true);
    try {
      const res = await searchAllGrep(term, { ignoreCase, glob: glob.trim() || undefined });
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
    <>
      <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
        <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t("Search across all repositories")}</h2>
          <button type="button" className="icon-btn" aria-label={t("Close")} title={t("Close")} onClick={onClose}><IconX /></button>
        </div>
        <form className="grep-form" onSubmit={runSearch}>
          <div className="grep-input">
            <IconSearch width={14} height={14} />
            <input
              autoFocus
              placeholder={t("Search text or regex in every registered repo…")}
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
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
            {t("Ignore case")}</label>
          <button type="submit" className="btn btn-primary" disabled={!pattern.trim() || loading}>
            {t("Search all")}</button>
        </form>
        <div className="modal-body no-pad grep-body">
          {loading ? (
            <div className="list-empty">{t("Searching all repositories…")}</div>
          ) : !searched ? (
            <div className="list-empty">{t("Enter a term to search tracked and untracked files across every repo.")}</div>
          ) : total === 0 ? (
            <div className="list-empty">{t("No matches in any repository.")}</div>
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
                        <div
                          className="grep-line clickable"
                          key={`${m.path}-${m.line}`}
                          role="button"
                          tabIndex={0}
                          title={t("Open this file at the matching line")}
                          onClick={() => openResult(repo.repo, m.path, m.line)}
                          onKeyDown={(e) => {
                            if (e.key !== 'Enter' && e.key !== ' ') return;
                            e.preventDefault();
                            openResult(repo.repo, m.path, m.line);
                          }}
                        >
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
            {searched ? t(`${total} matches across ${results.length} repos`) : ''}
          </span>
          <button type="button" className="btn" onClick={onClose}>{t("Close")}</button>
        </div>
        </div>
      </div>
      {openMatch && (
        <FileViewer
          repo={openMatch.repo}
          filePath={openMatch.path}
          initialLine={openMatch.line}
          highlight={pattern.trim()}
          onClose={() => setOpenMatch(null)}
        />
      )}
    </>
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
