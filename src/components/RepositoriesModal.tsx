// Multi-repository panel: every registered repository in one filterable list,
// showing its location, working-tree changes, ahead/behind and current branch.
// A row opens that repository; checkboxes enable batch fetch and batch pull.
// Pinned repositories sort first, freshness drives the activity bar, and the
// header aggregates work in progress across every repository.
import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchRepo, pullReposBatch } from '../api';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import type { RepoBrief } from '../types';
import { activityLevel, relativeAge, sortRepos, summarizeRepos } from '../lib/repo-sort';
import { IconBranch, IconPin, IconRefresh, IconSearch, IconX } from './icons';

const PIN_KEY = 'pr-helper-git2-pinned';

function loadPinned(): string[] {
  try {
    const raw = localStorage.getItem(PIN_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

function savePinned(paths: string[]): void {
  try {
    localStorage.setItem(PIN_KEY, JSON.stringify(paths));
  } catch {
    /* private mode: pinning is a nicety, not a requirement */
  }
}

function parentDir(p: string) {
  const idx = p.lastIndexOf('/');
  return idx > 0 ? p.slice(0, idx) : p;
}

export default function RepositoriesModal({ onClose }: { onClose: () => void }) {
  const {
    repos,
    activeRepo,
    selectRepo,
    refresh,
    toast,
  } = useApp();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [pullReport, setPullReport] = useState<{ okCount: number; failures: string[] } | null>(null);
  const [pinned, setPinned] = useState<string[]>(() => loadPinned());
  const [dirtyOnly, setDirtyOnly] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  useEscape(onClose);

  useEffect(() => {
    const timer = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Status is a snapshot; refresh it while the panel stays open so a list left
  // on screen does not go stale. This only re-runs `git status`, it never fetches
  // or pulls, so it cannot change a repository behind the user's back.
  useEffect(() => {
    if (!autoRefresh) return;
    let alive = true;
    const timer = window.setInterval(() => {
      if (!alive) return;
      refresh().catch(() => { /* refresh errors are surfaced separately */ });
    }, 30000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [autoRefresh, refresh]);

  const aggregate = useMemo(() => summarizeRepos(repos), [repos]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = repos;
    if (q) {
      list = list.filter((r) => r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q));
    }
    if (dirtyOnly) {
      list = list.filter((r) => r.staged + r.unstaged + r.untracked > 0 || r.ahead > 0 || r.behind > 0);
    }
    return sortRepos(list, pinned);
  }, [repos, query, dirtyOnly, pinned]);

  function togglePin(path: string) {
    setPinned((prev) => {
      const next = prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path];
      savePinned(next);
      return next;
    });
  }

  async function manualRefresh() {
    setRefreshing(true);
    try {
      await refresh();
    } catch {
      /* refresh errors are surfaced separately */
    } finally {
      setRefreshing(false);
    }
  }

  const allFilteredChecked = filtered.length > 0
    && filtered.every((r) => selected.has(r.path));

  function toggleOne(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredChecked) filtered.forEach((r) => next.delete(r.path));
      else filtered.forEach((r) => next.add(r.path));
      return next;
    });
  }

  function openRepo(path: string) {
    selectRepo(path);
    onClose();
  }

  function addRepository() {
    onClose();
    window.dispatchEvent(new CustomEvent('git2:add-repo'));
  }

  async function batchFetch() {
    const paths = [...selected];
    if (paths.length === 0) return;
    setBatchBusy(true);
    const results = await Promise.allSettled(paths.map((p) => fetchRepo(p)));
    const failed = results.filter((r) => r.status === 'rejected').length;
    const fetched = results.length - failed;
    try {
      await refresh();
    } catch { /* refresh errors are surfaced separately */ }
    setBatchBusy(false);
    setSelected(new Set());
    if (failed === 0) toast(`Fetched ${fetched} repositories`, 'success');
    else toast(`Fetched ${fetched}, ${failed} failed`, 'error');
  }

  // Fast-forward-only batch pull: a diverged or dirty repository fails instead
  // of silently creating a merge commit off-screen.
  async function batchPull() {
    const paths = [...selected];
    if (paths.length === 0) return;
    setBatchBusy(true);
    setPullReport(null);
    try {
      const res = await pullReposBatch(paths);
      try {
        await refresh();
      } catch { /* refresh errors are surfaced separately */ }
      const failures = res.results
        .filter((r) => !r.ok)
        .map((r) => `${parentDir(r.repo)}: ${r.error || 'pull failed'}`);
      setPullReport({ okCount: res.okCount, failures });
      if (res.failCount === 0) toast(`Pulled ${res.okCount} repositories`, 'success');
      else toast(`Pulled ${res.okCount}, ${res.failCount} failed`, 'error');
    } catch (err: any) {
      toast(err?.message || 'batch pull failed', 'error');
    } finally {
      setBatchBusy(false);
      setSelected(new Set());
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal modal-wide repo-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Open repositories</h2>
          <button type="button" className="icon-btn" aria-label="Close" title="Close" onClick={onClose}>
            <IconX />
          </button>
        </div>

        <div className="repo-panel-search">
          <IconSearch width={14} height={14} />
          <input
            ref={searchRef}
            type="text"
            value={query}
            placeholder="Filter repositories by name or path…"
            aria-label="Filter repositories"
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              type="button"
              className="icon-btn"
              aria-label="Clear filter"
              title="Clear filter"
              onClick={() => setQuery('')}
            >
              <IconX width={13} height={13} />
            </button>
          )}
        </div>

        <div className="repo-panel-agg">
          <span>{aggregate.repos} repositories</span>
          <span className={aggregate.changedFiles > 0 ? 'agg-dirty' : ''}>{aggregate.changedFiles} changed files</span>
          {aggregate.behind > 0 && <span className="agg-behind">{aggregate.behind} behind</span>}
          {aggregate.ahead > 0 && <span className="agg-ahead">{aggregate.ahead} unpushed</span>}
          {aggregate.unavailable > 0 && <span className="agg-err">{aggregate.unavailable} unavailable</span>}
          <span className="spacer" />
          <button
            type="button"
            className="icon-btn"
            title="Refresh status"
            aria-label="Refresh status"
            disabled={refreshing}
            onClick={manualRefresh}
          >
            <IconRefresh width={13} height={13} />
          </button>
        </div>

        <div className="repo-panel-head" aria-hidden="true">
          <input
            type="checkbox"
            checked={allFilteredChecked}
            onChange={toggleAll}
            aria-label="Select all repositories"
            disabled={filtered.length === 0}
          />
          <span>Repository</span>
          <span>Location</span>
          <span className="repo-panel-col-status">Status</span>
          <span className="repo-panel-col-branch">Branch</span>
        </div>

        <div className="repo-panel-list">
          {repos.length === 0 ? (
            <div className="list-empty">No repositories yet. Add one to get started.</div>
          ) : filtered.length === 0 ? (
            <div className="list-empty">
              {dirtyOnly && !query
                ? 'Nothing to sync — every repository is clean and in sync.'
                : `No repositories match “${query || 'the current filter'}”.`}
            </div>
          ) : (
            filtered.map((r: RepoBrief) => {
              const isActive = r.path === activeRepo;
              const isChecked = selected.has(r.path);
              const isPinned = pinned.includes(r.path);
              const dirty = r.staged + r.unstaged + r.untracked;
              const level = activityLevel(r.lastCommit?.at);
              return (
                <div
                  key={r.path}
                  className={`repo-panel-row${isActive ? ' is-active' : ''}${isChecked ? ' is-checked' : ''}`}
                  onClick={() => openRepo(r.path)}
                >
                  <span
                    className={`repo-panel-activity lv-${level}`}
                    title={r.lastCommit?.at ? `Last commit ${relativeAge(r.lastCommit.at)}${r.lastCommit.subject ? ` — ${r.lastCommit.subject}` : ''}` : 'No commits yet'}
                    aria-hidden="true"
                  />
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggleOne(r.path)}
                    aria-label={`Select ${r.name}`}
                  />
                  <span className="repo-panel-name">
                    <button
                      type="button"
                      className={`repo-pin${isPinned ? ' is-pinned' : ''}`}
                      title={isPinned ? 'Unpin repository' : 'Pin repository'}
                      aria-label={isPinned ? `Unpin ${r.name}` : `Pin ${r.name}`}
                      aria-pressed={isPinned}
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePin(r.path);
                      }}
                    >
                      <IconPin width={13} height={13} />
                    </button>
                    {r.name}
                    {isActive && <span className="repo-panel-active">active</span>}
                    {r.lastCommit?.at && <span className="repo-panel-age">{relativeAge(r.lastCommit.at)}</span>}
                  </span>
                  <span className="repo-panel-location" title={r.path}>
                    {parentDir(r.path)}
                  </span>
                  <span className="repo-panel-status">
                    {r.error ? (
                      <span className="repo-panel-err" title={r.error}>unavailable</span>
                    ) : (
                      <>
                        {dirty > 0 && (
                          <span className="repo-panel-dirty">
                            {r.staged > 0 && <b className="c-staged" title="staged">{r.staged}</b>}
                            {r.unstaged > 0 && <b className="c-unstaged" title="unstaged">{r.unstaged}</b>}
                            {r.untracked > 0 && <b className="c-untracked" title="untracked">{r.untracked}</b>}
                          </span>
                        )}
                        {(r.ahead > 0 || r.behind > 0) && (
                          <span className="repo-panel-ab">
                            {r.ahead > 0 && <span className="c-ahead">↑{r.ahead}</span>}
                            {r.behind > 0 && <span className="c-behind">↓{r.behind}</span>}
                          </span>
                        )}
                        {dirty === 0 && r.ahead === 0 && r.behind === 0 && (
                          <span className="repo-panel-clean">clean</span>
                        )}
                      </>
                    )}
                  </span>
                  <span className="repo-panel-branch">
                    {r.branch ? (
                      <span className="ref-badge branch">
                        <IconBranch width={11} height={11} />
                        {r.branch}
                      </span>
                    ) : (
                      <span className="ref-badge branch">
                        <IconBranch width={11} height={11} />
                        detached
                      </span>
                    )}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {pullReport && (
          <div className="repo-panel-report">
            <span className="repo-panel-report-head">
              Pulled {pullReport.okCount} of {pullReport.okCount + pullReport.failures.length}
              {pullReport.failures.length > 0 ? ` — ${pullReport.failures.length} failed` : ''}
            </span>
            {pullReport.failures.slice(0, 4).map((line) => (
              <span key={line} className="repo-panel-report-line">{line}</span>
            ))}
            {pullReport.failures.length > 4 && (
              <span className="repo-panel-report-line">+{pullReport.failures.length - 4} more</span>
            )}
          </div>
        )}

        <div className="modal-footer repo-panel-footer">
          <button type="button" className="btn" onClick={addRepository}>Add repository…</button>
          <label className="repo-panel-toggle">
            <input type="checkbox" checked={dirtyOnly} onChange={(e) => setDirtyOnly(e.target.checked)} />
            With changes
          </label>
          <label className="repo-panel-toggle" title="Re-read git status every 30s while this panel is open; never fetches or pulls">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            Auto refresh
          </label>
          <span className="spacer" />
          {selected.size > 0 && (
            <>
              <span className="repo-panel-count">{selected.size} selected</span>
              <button
                type="button"
                className="btn"
                onClick={() => setSelected(new Set())}
                disabled={batchBusy}
              >
                Clear
              </button>
              <button
                type="button"
                className="btn"
                onClick={batchFetch}
                disabled={batchBusy}
              >
                {batchBusy ? 'Working…' : `Fetch ${selected.size}`}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={batchPull}
                disabled={batchBusy}
                title="git pull --ff-only in each selected repository; diverged or dirty repositories fail without merging"
              >
                {batchBusy ? 'Working…' : `Pull ${selected.size} (ff-only)`}
              </button>
            </>
          )}
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
