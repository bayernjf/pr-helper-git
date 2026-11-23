import { errorMessage } from '../lib/errors';
// Dashboard — a full-page, at-a-glance status view of every registered
// repository (parity with pr-helper-git's dashboard page):
//   card grid with branch/↑↓/WIP counts/open-PR count/last commit,
//   conflict-first sort, pinned-first, filter + sort menu,
//   right-click menu (open / pin / Finder / Terminal / VS Code / remove),
//   30s auto-refresh, silent background fetch-all every 10 minutes.
import { useEffect, useMemo, useRef, useState } from 'react';
import { openExternal, removeRepo, fetchRepo, getRemote, githubProxy, pushRepo } from '../api';
import { useActiveRepo, usePreferences, useRepoRegistry } from '../app-state/hooks';
import { useAppToast } from '../app-state/toast';
import { activityLevel, relativeAge, repoIsClean, wipCount } from '../lib/repo-sort';
import type { RepoBrief } from '../types';
import { Dropdown } from './Dropdown';
import { ContextMenu } from './context-menu';
import type { MenuItem } from './context-menu';
import { IconBranch, IconPencil, IconPin, IconPlus, IconRefresh, IconSearch, IconTrash, IconDownload, IconUpload } from './icons';
import { useConfirm } from './ui';
import { t, tp } from '../i18n';

import { STORAGE_KEYS } from '../lib/storage-keys';

type SortKey = 'conflict' | 'name' | 'recent' | 'changes';
type ViewMode = 'cards' | 'list';
const SORT_KEY = STORAGE_KEYS.dashboardSort;
const VIEW_KEY = STORAGE_KEYS.dashboardView;
const AUTO_FETCH_KEY = STORAGE_KEYS.dashboardAutofetch;
const AUTO_FETCH_MS = 10 * 60_000;
const PIN_KEY = STORAGE_KEYS.pinned;

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

// Dashboard keeps one repository shortcut for the operation that used to live
// in the global toolbar: push a branch that has commits to publish, or one
// that still needs its upstream configured. Fetch/Pull/Stash stay in Git.
function canPushRepository(r: RepoBrief) {
  return Boolean(r.branch && !r.error && (r.ahead > 0 || !r.upstream));
}

export default function DashboardPage() {
  const { repos, reposLoaded, refresh } = useRepoRegistry();
  const { activeRepo, selectRepo } = useActiveRepo();
  const { pat, hasServerPat } = usePreferences();
  const toast = useAppToast();
  const confirm = useConfirm();
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>(() => (localStorage.getItem(SORT_KEY) as SortKey) || 'conflict');
  const [view, setView] = useState<ViewMode>(() => (localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'cards'));
  const [pinned, setPinned] = useState<string[]>(() => loadPinned());
  const [prCounts, setPrCounts] = useState<Record<string, number | null>>({});
  const [owners, setOwners] = useState<Record<string, string | null>>({});
  const [autoFetch, setAutoFetch] = useState(() => localStorage.getItem(AUTO_FETCH_KEY) !== '0');
  const [fetchingAll, setFetchingAll] = useState(false);
  const [pushingPath, setPushingPath] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; repo: RepoBrief } | null>(null);
  const lastFetchAll = useRef(0);
  const initialFetchStarted = useRef(false);
  const removeHint = t('Only removes it from this list. The local clone and GitHub remote stay untouched.');

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

  // The first paint must not wait for the 10-minute poll. The dashboard can
  // open long after the last status snapshot, so fetch every repo once when
  // the registry is ready; auto-fetch only owns the periodic refresh after that.
  useEffect(() => {
    if (initialFetchStarted.current || !reposLoaded || repos.length === 0) return;
    initialFetchStarted.current = true;
    void fetchAll({ silent: true });
  }, [reposLoaded, repos.length]);

  // Silent background fetch-all every 10 minutes. The interval is stable —
  // repos/fetchingAll are read from refs so every status refresh does not
  // tear down and restart the timer before it ever ticks.
  const reposRef = useRef(repos);
  const fetchingRef = useRef(fetchingAll);
  reposRef.current = repos;
  fetchingRef.current = fetchingAll;
  useEffect(() => {
    if (!autoFetch) return;
    const timer = window.setInterval(() => {
      if (document.hidden || fetchingRef.current || document.querySelector('.modal-backdrop')) return;
      if (Date.now() - lastFetchAll.current < AUTO_FETCH_MS - 1500) return;
      lastFetchAll.current = Date.now();
      setFetchingAll(true);
      Promise.allSettled(reposRef.current.map((r) => fetchRepo(r.path)))
        .then(() => refresh().catch(() => undefined))
        .catch(() => undefined)
        .finally(() => setFetchingAll(false));
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [autoFetch, refresh]);

  const repoKey = repos.map((r) => r.path).join('\u0000');

  // Remote identity for every repository (GitHub owner for the list view), and
  // open-PR counts for GitHub-hosted repos when a PAT exists.
  useEffect(() => {
    if (repos.length === 0) {
      setPrCounts({});
      setOwners({});
      return;
    }
    let alive = true;
    const snapshot = repos;
    void (async () => {
      const next: Record<string, number | null> = {};
      const identities = await Promise.allSettled(snapshot.map((r) => getRemote(r.path)));
      const ownerMap: Record<string, string | null> = {};
      repos.forEach((r, i) => {
        const id = identities[i].status === 'fulfilled' ? identities[i].value.remote : null;
        ownerMap[r.path] = id?.isGithub && id.owner ? id.owner : null;
      });
      if (!alive) return;
      setOwners(ownerMap);
      if (!pat && !hasServerPat) {
        setPrCounts({});
        return;
      }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run on repo-set content, not on the refreshed array reference
  }, [pat, hasServerPat, repoKey]);

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
      detail: removeHint,
      confirmLabel: t('Remove'),
      danger: true,
    });
    if (!ok) return;
    try {
      await removeRepo(path);
      await refresh().catch(() => undefined);
      toast(t('{name} removed').replace('{name}', name), 'success');
    } catch (err) {
      toast(errorMessage(err) || t('remove failed'), 'error');
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
      noUpstream: repos.reduce((n, r) => n + (r.branch && !r.upstream ? 1 : 0), 0),
    }),
    [repos],
  );

  async function fetchAll({ silent = false }: { silent?: boolean } = {}) {
    setFetchingAll(true);
    const results = await Promise.allSettled(repos.map((r) => fetchRepo(r.path)));
    const failed = results.filter((r) => r.status === 'rejected').length;
    lastFetchAll.current = Date.now();
    try {
      await refresh().catch(() => undefined);
    } finally {
      setFetchingAll(false);
    }
    if (!silent) {
      if (failed === 0) toast(tp('{count} repositories fetched', { count: repos.length }), 'success');
      else toast(tp('{ok} fetched, {failed} failed', { ok: repos.length - failed, failed }), 'error');
    }
  }

  async function pushRepository(repo: RepoBrief) {
    if (!repo.branch || pushingPath) return;
    const setUpstream = !repo.upstream;
    setPushingPath(repo.path);
    try {
      await pushRepo(repo.path, setUpstream);
      await refresh();
      toast(setUpstream ? t('Pushed and set upstream') : t('Pushed'), 'success');
    } catch (err) {
      await refresh().catch(() => undefined);
      toast(errorMessage(err) || t('push failed'), 'error');
    } finally {
      setPushingPath(null);
    }
  }

  const cardMenu = (repo: RepoBrief): MenuItem[] => {
    const items: MenuItem[] = [
      { id: 'open', label: t('Open repository') },
      { id: 'pin', label: pinned.includes(repo.path) ? t('Unpin') : t('Pin to top') },
      { separator: true },
    ];
    if (canPushRepository(repo)) {
      items.push(
        {
          id: 'push',
          label: repo.upstream ? `${t('Push')} ${repo.branch}` : t('Push and set upstream'),
          icon: <IconUpload width={13} height={13} />,
          disabled: pushingPath !== null,
        },
        { separator: true },
      );
    }
    items.push(
      { id: 'finder', label: t('Reveal in Finder') },
      { id: 'terminal', label: t('Open in Terminal') },
      { id: 'editor', label: t('Open in VS Code') },
      { separator: true },
      { id: 'remove', label: t('Remove from list'), title: removeHint, danger: true },
    );
    return items;
  };

  const onMenuSelect = (repo: RepoBrief, id: string) => {
    if (id === 'open') selectRepo(repo.path);
    else if (id === 'pin') togglePin(repo.path);
    else if (id === 'push') void pushRepository(repo);
    else if (id === 'finder') external(repo.path, 'finder');
    else if (id === 'terminal') external(repo.path, 'terminal');
    else if (id === 'editor') external(repo.path, 'editor');
    else if (id === 'remove') void remove(repo.path, repo.name);
  };

  function changeView(next: ViewMode) {
    setView(next);
    localStorage.setItem(VIEW_KEY, next);
  }

  // Owner column: the GitHub owner when the remote resolves, otherwise the
  // containing folder — GitKraken's "owner" column shows the remote account.
  const ownerLabel = (r: RepoBrief) => owners[r.path] || parentDir(r.path).split('/').pop() || parentDir(r.path);

  const statusPills = (r: RepoBrief) => {
    const wip = wipCount(r);
    return (
      <>
        {r.unmerged > 0 && (
          <span className="dash-pill conflict">{tp('{count} conflicts', { count: r.unmerged })}</span>
        )}
        {wip > 0 && (
          <span
            className="dash-pill wip"
          >
            <IconPencil width={11} height={11} /> {wip}
          </span>
        )}
        {r.ahead > 0 && <span className="dash-pill ahead">↑{r.ahead}</span>}
        {r.behind > 0 && <span className="dash-pill behind">↓{r.behind}</span>}
        {r.branch && !r.upstream && (
          <span
            className="dash-pill no-upstream"
            title={t('This branch has no upstream. Set one before pushing.')}
          >
            {t('no upstream')}
          </span>
        )}
      </>
    );
  };

  const isClean = (r: RepoBrief) => repoIsClean(r);

  const renderPushButton = (r: RepoBrief) => {
    if (!canPushRepository(r)) return null;
    return (
      <button
        type="button"
        className="icon-btn dash-push"
        aria-label={r.upstream ? `${t('Push')} ${r.branch}` : t('Push and set upstream')}
        title={r.upstream ? `${t('Push')} ${r.branch}` : t('Push and set upstream')}
        aria-busy={pushingPath === r.path}
        disabled={pushingPath !== null}
        onClick={(e) => { e.stopPropagation(); void pushRepository(r); }}
      >
        <IconUpload width={14} height={14} />
      </button>
    );
  };

  const staleBadge = (r: RepoBrief) => {
    // Parity with pr-helper-git: repos dormant for 90+ days get a visible stale
    // badge so abandoned work stands out.
    const at = r.lastCommit?.at ? Date.parse(r.lastCommit.at) : 0;
    const days = at ? Math.floor((Date.now() - at) / 86_400_000) : null;
    return days !== null && days > 90 ? (
      <span className="dash-pill stale">
        {t('stale')} · {days}d
      </span>
    ) : null;
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
            {aggregate.noUpstream > 0 && (
              <span className="dash-pill no-upstream">
                {tp('{count} no upstream', { count: aggregate.noUpstream })}
              </span>
            )}
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
        <div className="dash-view-toggle" role="group" aria-label={t('View mode')}>
          <button
            type="button"
            className={view === 'cards' ? 'is-active' : ''}
            aria-pressed={view === 'cards'}
            onClick={() => changeView('cards')}
          >
            {t('Cards')}
          </button>
          <button
            type="button"
            className={view === 'list' ? 'is-active' : ''}
            aria-pressed={view === 'list'}
            onClick={() => changeView('list')}
          >
            {t('List')}
          </button>
        </div>
        <Dropdown
          value={sortKey}
          onChange={(v) => {
            setSortKey(v as SortKey);
            localStorage.setItem(SORT_KEY, v);
          }}
          options={[
            { value: 'conflict', label: t('Conflicts first') },
            { value: 'name', label: t('Name') },
            { value: 'recent', label: t('Recent commit') },
            { value: 'changes', label: t('Change count') },
          ]}
        />
        <button type="button" className="icon-btn" aria-label={t('Refresh status')} disabled={refreshing} onClick={async () => { setRefreshing(true); try { await refresh(); } finally { setRefreshing(false); } }}>
          <IconRefresh width={14} height={14} />
        </button>
        <button type="button" className="icon-btn" aria-label={t('Fetch all repositories')} disabled={fetchingAll || repos.length === 0} onClick={() => void fetchAll()}>
          <IconDownload width={14} height={14} />
        </button>
        <button type="button" className="icon-btn" aria-label={t('Add repository…')} onClick={() => window.dispatchEvent(new CustomEvent('git2:add-repo'))}>
          <IconPlus width={14} height={14} />
        </button>
      </div>

      <div className="dash-toolbar">
        <label className="repo-panel-toggle">
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
        <span className="dash-hint">{view === 'cards' ? t('Right-click a card for more actions') : t('Right-click a row for more actions')}</span>
      </div>

      {!reposLoaded ? (
        <div className="dash-empty">
          <span className="spinner" aria-hidden="true" />
          <p>{t('Loading repositories…')}</p>
        </div>
      ) : repos.length === 0 ? (
        <div className="dash-empty">
          <p>{t('No repositories yet. Add one to get started.')}</p>
          <button type="button" className="btn btn-primary" onClick={() => window.dispatchEvent(new CustomEvent('git2:add-repo'))}>
            <IconPlus width={13} height={13} /> {t('Add repository…')}
          </button>
        </div>
      ) : view === 'cards' ? (
        <div className="dash-grid">
          {sorted.map((r) => {
            const isActive = r.path === activeRepo;
            const isPinned = pinned.includes(r.path);
            const level = activityLevel(r.lastCommit?.at);
            const prs = prCounts[r.path];
            return (
              <div
                key={r.path}
                role="button"
                tabIndex={0}
                aria-pressed={isActive}
                className={`dash-card${isActive ? ' is-active' : ''}${r.unmerged > 0 ? ' has-conflict' : ''}`}
                onClick={() => selectRepo(r.path)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectRepo(r.path); } }}
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
                    aria-label={isPinned ? t('Unpin') : t('Pin to top')}
                    aria-pressed={isPinned}
                    onClick={(e) => { e.stopPropagation(); togglePin(r.path); }}
                  >
                    <IconPin width={13} height={13} />
                  </button>
                  <span className="dash-card-name">{r.name}</span>
                  {isActive && <span className="repo-panel-active">{t('active')}</span>}
                  {prs !== null && prs !== undefined && prs > 0 && (
                    <span className="dash-pill pr">PR {prs}</span>
                  )}
                  {staleBadge(r)}
                  <span className="spacer" />
                  {renderPushButton(r)}
                  <button
                    type="button"
                    className="icon-btn dash-remove"
                    aria-label={`${t('Remove from list')}: ${r.name}`}
                    title={removeHint}
                    onClick={(e) => { e.stopPropagation(); void remove(r.path, r.name); }}
                  >
                    <IconTrash width={13} height={13} />
                  </button>
                </div>
                <div className="dash-card-path">{parentDir(r.path)}</div>
                <div className="dash-card-meta">
                  {r.error ? (
                    <span className="repo-panel-err">{t('unavailable')}</span>
                  ) : (
                    <>
                      {r.branch ? (
                        <span className="ref-badge branch"><IconBranch width={11} height={11} /> {r.branch}</span>
                      ) : (
                        <span className="ref-badge branch"><IconBranch width={11} height={11} /> detached</span>
                      )}
                      {statusPills(r)}
                      {isClean(r) && <span className="repo-panel-clean">{t('clean')}</span>}
                    </>
                  )}
                </div>
                <div className="dash-card-commit">
                  {r.lastCommit ? `${relativeAge(r.lastCommit.at)} · ${r.lastCommit.subject}` : t('No commits yet.')}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="dash-list">
          <div className="dash-list-head">
            <span>{t('Repository')}</span>
            <span>{t('Owner')}</span>
            <span>{t('Branch')}</span>
            <span>{t('Status')}</span>
            <span>{t('Last commit')}</span>
            <span aria-hidden="true" />
          </div>
          {sorted.map((r) => {
            const isActive = r.path === activeRepo;
            const isPinned = pinned.includes(r.path);
            const prs = prCounts[r.path];
            return (
              <div
                key={r.path}
                role="button"
                tabIndex={0}
                aria-pressed={isActive}
                className={`dash-row${isActive ? ' is-active' : ''}${r.unmerged > 0 ? ' has-conflict' : ''}`}
                onClick={() => selectRepo(r.path)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectRepo(r.path); } }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ x: e.clientX, y: e.clientY, repo: r });
                }}
              >
                <span className="dash-row-repo">
                  <button
                    type="button"
                    className={`repo-pin${isPinned ? ' is-pinned' : ''}`}
                    aria-label={isPinned ? t('Unpin') : t('Pin to top')}
                    aria-pressed={isPinned}
                    onClick={(e) => { e.stopPropagation(); togglePin(r.path); }}
                  >
                    <IconPin width={12} height={12} />
                  </button>
                  <span className="dash-row-name">{r.name}</span>
                  {isActive && <span className="repo-panel-active">{t('active')}</span>}
                </span>
                <span className="dash-row-path">{ownerLabel(r)}</span>
                <span className="dash-row-branch">
                  {r.error ? (
                    <span className="repo-panel-err">{t('unavailable')}</span>
                  ) : r.branch ? (
                    <span className="ref-badge branch"><IconBranch width={11} height={11} /> {r.branch}</span>
                  ) : (
                    <span className="ref-badge branch"><IconBranch width={11} height={11} /> detached</span>
                  )}
                </span>
                <span className="dash-row-status">
                  {!r.error && statusPills(r)}
                  {!r.error && isClean(r) && <span className="repo-panel-clean">{t('clean')}</span>}
                  {prs !== null && prs !== undefined && prs > 0 && (
                    <span className="dash-pill pr">PR {prs}</span>
                  )}
                  {staleBadge(r)}
                </span>
                <span className="dash-row-commit">
                  {r.lastCommit ? `${relativeAge(r.lastCommit.at)} · ${r.lastCommit.subject}` : t('No commits yet.')}
                </span>
                <span className="dash-row-actions">
                  {renderPushButton(r)}
                  <button
                    type="button"
                    className="icon-btn dash-remove"
                    aria-label={`${t('Remove from list')}: ${r.name}`}
                    title={removeHint}
                    onClick={(e) => { e.stopPropagation(); void remove(r.path, r.name); }}
                  >
                    <IconTrash width={13} height={13} />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}

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
