import { errorMessage } from '../lib/errors';
// Search the whole commit history (every reachable ref), not just the loaded
// graph page. A bare query matches the message; `author:` and `path:` narrow it
// to an author or to commits touching a path. Selecting a result jumps the
// commit detail pane to that commit.
import { useMemo, useState } from 'react';
import { searchCommits } from '../api';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import { formatRelative, shortHash } from '../lib/format';
import type { Commit } from '../types';
import { IconSearch, IconX } from './icons';
import { t, tp } from '../i18n';

type Mode = 'message' | 'author' | 'path';

const PLACEHOLDERS: Record<Mode, string> = {
  message: 'Search commit messages across every branch…',
  author: 'Author name or email…',
  path: 'File or directory path…',
};

export default function CommitSearchModal({ onClose }: { onClose: () => void }) {
  const { activeRepo, selectCommit, setView, toast } = useApp();
  const [draft, setDraft] = useState('');
  const [commits, setCommits] = useState<Commit[]>([]);
  const [searched, setSearched] = useState<{ mode: Mode; term: string } | null>(null);
  const [loading, setLoading] = useState(false);
  useEscape(onClose);

  // The prefix in the draft decides what the box searches, so the hint and the
  // placeholder follow it live.
  const mode: Mode = useMemo(() => {
    const match = draft.match(/^\s*(author|path)\s*:/i);
    if (!match) return 'message';
    return match[1].toLowerCase() === 'author' ? 'author' : 'path';
  }, [draft]);

  function applyPrefix(prefix: 'author:' | 'path:') {
    setDraft((prev) => (new RegExp(`^\\s*${prefix}`, 'i').test(prev) ? prev : prefix));
  }

  async function runSearch(event?: React.FormEvent) {
    event?.preventDefault();
    if (!activeRepo) return;
    const q = draft.trim();
    if (!q) return;
    setLoading(true);
    try {
      const res = await searchCommits(activeRepo, q);
      setCommits(res.commits);
      setSearched({ mode: res.mode, term: res.query });
    } catch (err) {
      toast(errorMessage(err) || 'search failed', 'error');
    } finally {
      setLoading(false);
    }
  }

  function openCommit(hash: string) {
    setView('git');
    selectCommit(hash);
    onClose();
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t("Search commits in all branches")}</h2>
          <button type="button" className="icon-btn" aria-label={t("Close")} title={t("Close")} onClick={onClose}><IconX /></button>
        </div>
        <form className="grep-form" onSubmit={runSearch}>
          <div className="grep-input">
            <IconSearch width={14} height={14} />
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={PLACEHOLDERS[mode]}
              aria-label={t("Commit search query")}
            />
          </div>
          <button
            type="button"
            className={`btn btn-small commit-search-prefix${mode === 'author' ? ' is-on' : ''}`}
            onClick={() => applyPrefix('author:')}
            title={t("Filter by author")}
          >
            {t("author:")}</button>
          <button
            type="button"
            className={`btn btn-small commit-search-prefix${mode === 'path' ? ' is-on' : ''}`}
            onClick={() => applyPrefix('path:')}
            title={t("Restrict to commits touching a path")}
          >
            {t("path:")}</button>
          <button type="submit" className="btn btn-primary" disabled={!draft.trim() || loading || !activeRepo}>
            {t("Search")}</button>
        </form>
        <div className="modal-body no-pad">
          {loading ? (
            <div className="list-empty">{t("Searching every reachable ref…")}</div>
          ) : !searched ? (
            <div className="list-empty">
              {t("Message search is case-insensitive and covers every branch, not just the visible page.")}
            </div>
          ) : commits.length === 0 ? (
            <div className="list-empty">
              {tp("No commit matches {term}.", { term: searched.mode === 'message' ? `“${searched.term}”` : `${searched.mode}:${searched.term}` })}
            </div>
          ) : (
            <div className="commit-search-list">
              {commits.map((commit) => (
                <div
                  className="commit-search-row"
                  key={commit.hash}
                  role="button"
                  tabIndex={0}
                  title={t("Show this commit")}
                  onClick={() => openCommit(commit.hash)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    openCommit(commit.hash);
                  }}
                >
                  <span className="commit-search-hash">{shortHash(commit.hash)}</span>
                  <span className="commit-search-subject">{commit.subject}</span>
                  <span className="commit-search-author">{commit.authorName}</span>
                  <span className="commit-search-date">{formatRelative(commit.date)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          {searched && commits.length > 0 && (
            <span className="repo-panel-count">{commits.length} {t("result")}{commits.length === 1 ? '' : 's'}</span>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={onClose}>{t("Close")}</button>
        </div>
      </div>
    </div>
  );
}
