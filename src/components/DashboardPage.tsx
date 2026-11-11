import { errorMessage } from '../lib/errors';
// Dashboard — a full-page, at-a-glance status view of every registered
// repository (parity with pr-helper-git's dashboard page):
//   card grid with branch/↑↓/WIP counts/open-PR count/last commit,
//   conflict-first sort, pinned-first, filter + sort menu,
//   right-click menu (open / pin / Finder / Terminal / VS Code / remove),
//   30s auto-refresh, silent background fetch-all every 10 minutes.
import { useEffect, useMemo, useRef, useState } from 'react';
import { openExternal, removeRepo, fetchRepo, getRemote, githubProxy } from '../api';
import { useApp } from '../app-state';
import { activityLevel, relativeAge } from '../lib/repo-sort';
import type { RepoBrief } from '../types';
import { Dropdown } from './Dropdown';
import { ContextMenu } from './context-menu';
import type { MenuItem } from './context-menu';
import { IconBranch, IconPin, IconPlus, IconRefresh, IconSearch, IconTrash, IconDownload } from './icons';
import { useConfirm } from './ui';
import { t, tp } from '../i18n';

type SortKey = 'conflict' | 'name' | 'recent' | 'changes';
const SORT_KEY = 'git2-dashboard-sort';
const AUTO_FETCH_KEY = 'git2-dashboard-autofetch';
const AUTO_FETCH_MS = 10 * 60_000;
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

function parentDir(p: string) {
  const idx = p.lastIndexOf('/');
  return idx > 0 ? p.slice(0, idx) : p;
}

export default function DashboardPage() {
  const { repos, activeRepo, selectRepo, refresh, pat, toast } = useApp();
  const confirm = useConfirm();
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>(() => (localStorage.getItem(SORT_KEY) as SortKey) || 'conflict');
  const [pinned, setPinned] = useState<string[]>(() => loadPinned());
  const [prCounts, setPrCounts] = useState<Record<string, number | null>>({});
  const [autoFetch, setAutoFetch] = useState(() => localStorage.getItem(AUTO_FETCH_KEY) !== '0');
  const [fetchingAll, setFetchingAll] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; repo: RepoBrief } | null>(null);
  const lastFetchAll = useRef(Date.now());
  const prTimerFatal = useRef(false);

  // 30s status refresh while the dashboard is visible.
  useEffect(() => {
    let alive = true;
    const timer = window.setInterval(() => {
      if (!alive || document.hidden || document.querySelector('.modal-backdrop')) return;
      refresh().catch(() => { /* surfaced separately */ });
    }, 30000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [refresh]);

  // Silent background fetch-all every 10 minutes.
  useEffect(() => {
    if (!autoFetch) return;
    const timer = window.setInterval(() => {
      if (document.hidden || fetchingAll || document.querySelector('.modal-backdrop')) return;
      if (Date.now() - lastFetchAll.current < AUTO_FETCH_MS - 1500) return;
      lastFetchAll.current = Date.now();
      setFetchingAll(true);
      Promise.allSettled(repos.map((r) => fetchRepo(r.path)))
        .then(() => refresh().catch(() => undefined))
        .catch(() => undefined)
        .finally(() => setFetchingAll(false));
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [autoFetch, repos, fetchingAll, refresh]);

  // Open-PR counts: only for GitHub-hosted repos, only when a PAT exists.
  useEffect(() => {
    if (!pat || prTimerFatal.current || repos.length === 0) {
      setPrCounts({});
      return;
    }
    let alive = true;
    void (async () => {
      const next: Record<string, number | null> = {};
      const identities = await Promise.allSettled(repos.map((r) => getRemote(r.path)));
      await Promise.allSettled(
        repos.map(async (r, i) => {
          const id = identities[i].status === 'fulfilled' ? identities[i].value.remote : null;
          if (!id?.isGithub || !id.owner || !id.repo) {
            next[r.path] = null;
            return;
          }
          try {
            const res = await githubProxy<{ length: number }>(
              pat,
              `/repos/${id.owner}/${id.repo}/pulls?state=open&per_page=100`,
            );
            next[r.path] = Array.isArray(res.data) ? res.data.length : null;
          } catch {
            next[r.path] = null;
          }
        }),
      );
      if (alive) setPrCounts(next);
    })();
    return () => {
      alive = false;
    };
  }, [pat, repos]);

  function togglePin(path: string) {
    setPinned((prev) => {
      const next = prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path];
      localStorage.setItem(PIN_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function remove(path: string, name: string) {
    const ok = await confirm({
      title: t('Remove {name} from the list?').replace('{name}', name),
      detail: t('Disk files stay untouched.'),
      confirmLabel: t('Remove'),
      danger: true,
    });
    if (!ok) return;
    try {
      await removeRepo(path);
      await refresh().catch(() => undefined);
      toast(t('{name} removed').replace('{name}', name), 'success');
    } catch (err) {
      toast(errorMessage(err) || 'remove failed', 'error');
    }
  }

  function external(path: string, target: 'finder' | 'terminal' | 'editor') {
    openExternal(path, target)
      .catch((err) => toast(errorMessage(err) || 'open failed', 'error'));
  }

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = repos;
    if (q) list = list.filter((r) => r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q));
    const rank = (r: RepoBrief) => {
      if (r.unmerged > 0) return 0;
      if (pinned.includes(r.path)) return 1;
      return 2;
    };
    list = [...list].sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      if (sortKey === 'recent') return (b.lastCommit?.at ? Date.parse(b.lastCommit.at) : 0) - (a.lastCommit?.at ? Date.parse(a.lastCommit.at) : 0);
      if (sortKey === 'changes') return b.staged + b.unstaged + b.untracked - (a.staged + a.unstaged + a.untracked);
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [repos, query, sortKey, pinned]);

  const aggregate = useMemo(
    () => ({
      repos: repos.length,
      dirty: repos.reduce((n, r) => n + r.staged + r.unstaged + r.untracked, 0),
      conflicts: repos.reduce((n, r) => n + r.unmerged, 0),
      behind: repos.reduce((n, r) => n + r.behind, 0),
      ahead: repos.reduce((n, r) => n + r.ahead, 0),
    }),
    [repos],
  );

  async function fetchAll() {
    setFetchingAll(true);
    const results = await Promise.allSettled(repos.map((r) => fetchRepo(r.path)));
    const failed = results.filter((r) => r.status === 'rejected').length;
    lastFetchAll.current = Date.now();
    try {
      await refresh().catch(() => undefined);
    } finally {
      setFetchingAll(false);
    }
    if (failed === 0) toast(t(`Fetched ${repos.length} repositories`), 'success');
    else toast(`Fetched ${repos.length - failed}, ${failed} failed`, 'error');
  }

  const cardMenu = (repo: RepoBrief): MenuItem[] => [
    { id: 'open', label: t('Open repository') },
    { id: 'pin', label: pinned.includes(repo.path) ? t('Unpin') : t('Pin to top') },
    { separator: true },
    { id: 'finder', label: t('Reveal in Finder') },
    { id: 'terminal', label: t('Open in Terminal') },
    { id: 'editor', label: t('Open in VS Code') },
    { separator: true },
    { id: 'remove', label: t('Remove from list'), danger: true },
  ];

  const onMenuSelect = (repo: RepoBrief, id: string) => {
    if (id === 'open') selectRepo(repo.path);
    else if (id === 'pin') togglePin(repo.path);
    else if (id === 'finder') external(repo.path, 'finder');
    else if (id === 'terminal') external(repo.path, 'terminal');
    else if (id === 'editor') external(repo.path, 'editor');
    else if (id === 'remove') void remove(repo.path, repo.name);
  };

  return (
    <div className="dashboard-page">
      <div className="dash-header">
        <div>
          <h1>{t('Repositories')}</h1>
          <div className="dash-subtitle">
            <span>{tp('{count} repositories', { count: aggregate.repos })}</span>
            {aggregate.dirty > 0 && <span className="dash-pill dirty">{aggregate.dirty} dirty</span>}
            {aggregate.conflicts > 0 && <span className="dash-pill conflict">{tp('{count} conflicts', { count: aggregate.conflicts })}</span>}
            {aggregate.behind > 0 && <span className="dash-pill behind">↓{aggregate.behind}</span>}
            {aggregate.ahead > 0 && <span className="dash-pill ahead">↑{aggregate.ahead}</span>}
          </div>
        </div>
        <span className="spacer" />
        <div className="dash-search">
          <IconSearch width={14} height={14} />
          <input
            type="text"
            value={query}
            placeholder={t('Filter repositories by name or path…')}
            aria-label={t('Filter repositories')}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Dropdown
          value={sortKey}
          onChange={(v) => {
            setSortKey(v as SortKey);
            localStorage.setItem(SORT_KEY, v);
          }}
          title={t('Sort order')}
          options={[
            { value: 'conflict', label: t('Conflicts first') },
            { value: 'name', label: t('Name') },
            { value: 'recent', label: t('Recent commit') },
            { value: 'changes', label: t('Change count') },
          ]}
        />
        <button type="button" className="icon-btn" title={t('Refresh status')} aria-label={t('Refresh status')} disabled={refreshing} onClick={async () => { setRefreshing(true); try { await refresh(); } finally { setRefreshing(false); } }}>
          <IconRefresh width={14} height={14} />
        </button>
        <button type="button" className="icon-btn" title={t('Fetch all repositories')} aria-label={t('Fetch all repositories')} disabled={fetchingAll || repos.length === 0} onClick={fetchAll}>
          <IconDownload width={14} height={14} />
        </button>
        <button type="button" className="icon-btn" title={t('Add repository…')} aria-label={t('Add repository…')} onClick={() => window.dispatchEvent(new CustomEvent('git2:add-repo'))}>
          <IconPlus width={14} height={14} />
        </button>
      </div>

      <div className="dash-toolbar">
        <label className="repo-panel-toggle" title={t('Silently fetch every repository every 10 minutes while this page is open')}>
          <input
            type="checkbox"
            checked={autoFetch}
            onChange={(e) => {
              setAutoFetch(e.target.checked);
              localStorage.setItem(AUTO_FETCH_KEY, e.target.checked ? '1' : '0');
            }}
          />
          {t('Auto fetch (10 min)')}
        </label>
        {fetchingAll && <span className="dash-fetching">{t('Fetching…')}</span>}
        <span className="spacer" />
        <span className="dash-hint">{t('Right-click a card for more actions')}</span>
      </div>

      <div className="dash-grid">
        {repos.length === 0 ? (
          <div className="dash-empty">
            <p>{t('No repositories yet. Add one to get started.')}</p>
            <button type="button" className="btn btn-primary" onClick={() => window.dispatchEvent(new CustomEvent('git2:add-repo'))}>
              <IconPlus width={13} height={13} /> {t('Add repository…')}
            </button>
          </div>
        ) : (
          sorted.map((r) => {
            const isActive = r.path === activeRepo;
            const isPinned = pinned.includes(r.path);
            const dirty = r.staged + r.unstaged + r.untracked;
            const level = activityLevel(r.lastCommit?.at);
            const prs = prCounts[r.path];
            return (
              <div
                key={r.path}
                className={`dash-card${isActive ? ' is-active' : ''}${r.unmerged > 0 ? ' has-conflict' : ''}`}
                onClick={() => selectRepo(r.path)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ x: e.clientX, y: e.clientY, repo: r });
                }}
              >
                <span className={`repo-panel-activity lv-${level}`} aria-hidden="true" />
                <div className="dash-card-head">
                  <button
                    type="button"
                    className={`repo-pin${isPinned ? ' is-pinned' : ''}`}
                    title={isPinned ? t('Unpin') : t('Pin to top')}
                    aria-pressed={isPinned}
                    onClick={(e) => { e.stopPropagation(); togglePin(r.path); }}
                  >
                    <IconPin width={13} height={13} />
                  </button>
                  <span className="dash-card-name">{r.name}</span>
                  {isActive && <span className="repo-panel-active">{t('active')}</span>}
                  {prs !== null && prs !== undefined && prs > 0 && (
                    <span className="dash-pill pr" title={t('Open pull requests')}>PR {prs}</span>
                  )}
                  {(() => {
                    // Parity with pr-helper-git: repos dormant for 90+ days get
                    // a visible stale badge so abandoned work stands out.
                    const at = r.lastCommit?.at ? Date.parse(r.lastCommit.at) : 0;
                    const days = at ? Math.floor((Date.now() - at) / 86_400_000) : null;
                    return days !== null && days > 90 ? (
                      <span className="dash-pill stale" title={t('No commits in {n} days').replace('{n}', String(days))}>
                        {t('stale')} · {days}d
                      </span>
                    ) : null;
                  })()}
                  <span className="spacer" />
                  <button
                    type="button"
                    className="icon-btn dash-remove"
                    title={t('Remove from list')}
                    aria-label={`${t('Remove from list')}: ${r.name}`}
                    onClick={(e) => { e.stopPropagation(); void remove(r.path, r.name); }}
                  >
                    <IconTrash width={13} height={13} />
                  </button>
                </div>
                <div className="dash-card-path" title={r.path}>{parentDir(r.path)}</div>
                <div className="dash-card-meta">
                  {r.error ? (
                    <span className="repo-panel-err" title={r.error}>{t('unavailable')}</span>
                  ) : (
                    <>
                      {r.branch ? (
                        <span className="ref-badge branch"><IconBranch width={11} height={11} /> {r.branch}</span>
                      ) : (
                        <span className="ref-badge branch"><IconBranch width={11} height={11} /> detached</span>
                      )}
                      {r.unmerged > 0 && <span className="dash-pill conflict">{tp('{count} conflicts', { count: r.unmerged })}</span>}
                      {r.staged > 0 && <span className="dash-pill dirty">{r.staged}■</span>}
                      {r.unstaged > 0 && <span className="dash-pill modified">{r.unstaged}▲</span>}
                      {r.untracked > 0 && <span className="dash-pill untracked">{r.untracked}?</span>}
                      {r.ahead > 0 && <span className="dash-pill ahead">↑{r.ahead}</span>}
                      {r.behind > 0 && <span className="dash-pill behind">↓{r.behind}</span>}
                      {dirty === 0 && r.ahead === 0 && r.behind === 0 && r.unmerged === 0 && (
                        <span className="repo-panel-clean">{t('clean')}</span>
                      )}
                    </>
                  )}
                </div>
                <div className="dash-card-commit" title={r.lastCommit?.subject || ''}>
                  {r.lastCommit ? `${relativeAge(r.lastCommit.at)} · ${r.lastCommit.subject}` : t('No commits yet.')}
                </div>
              </div>
            );
          })
        )}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={cardMenu(menu.repo)}
          title={menu.repo.name}
          onSelect={(id) => {
            onMenuSelect(menu.repo, id);
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
