import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  abortMerge,
  abortRebase,
  continueRebase,
  checkoutRef,
  deleteBranch,
  deleteTag,
  deleteRemoteBranch,
  deleteRemoteTag,
  getStashList,
  getStashShow,
  getTagShow,
  pushBranch,
  pushTag,
  renameBranch,
  setBranchUpstream,
  stashApply,
  stashDrop,
  type StashEntry,
  type TagDetail,
} from '../api';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import { useResizable } from '../hooks/use-resizable';
import { ContextMenu, type MenuItem } from './context-menu';
import {
  IconBranch,
  IconChevronDown,
  IconChevronRight,
  IconDownload,
  IconEdit,
  IconEye,
  IconMerge,
  IconMore,
  IconPin,
  IconPlus,
  IconSearch,
  IconStash,
  IconTag,
  IconTrash,
  IconUpload,
  IconX,
} from './icons';
import MergeModal from './MergeModal';
import NewBranchModal from './NewBranchModal';
import { useConfirm } from './ui';
import { getPref, setPref, repoPref } from '../lib/prefs';
import type { Ref } from '../types';

type MenuKind = 'local' | 'remote' | 'tag' | 'stash';

interface MenuState {
  x: number;
  y: number;
  kind: MenuKind;
  name: string;
  stashIndex?: number;
}

interface RenameState {
  name: string;
  value: string;
}

function GroupHead({
  label,
  count,
  open,
  onToggle,
  action,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
}) {
  return (
    <div className="ref-group-head" style={{ paddingRight: 10 }}>
      <button type="button" className="ref-group-head" style={{ padding: 0, flex: 1 }} onClick={onToggle}>
        <span className="chev">{open ? <IconChevronDown width={13} height={13} /> : <IconChevronRight width={13} height={13} />}</span>
        {label}
        <span className="count">{count}</span>
      </button>
      {action}
    </div>
  );
}

function Row({
  icon,
  name,
  current,
  badge,
  onOpen,
  onMenu,
}: {
  icon: React.ReactNode;
  name: string;
  current?: boolean;
  badge?: React.ReactNode;
  onOpen: () => void;
  onMenu: (e: React.MouseEvent) => void;
}) {
  return (
    <div className={`ref-row${current ? ' current' : ''}`} onClick={onOpen} title={name}>
      <span className="ref-icon">{icon}</span>
      <span className="ref-name">{name}</span>
      {badge}
      <button
        type="button"
        className="row-more"
        aria-label={`Actions for ${name}`}
        title="More actions"
        onClick={(e) => {
          e.stopPropagation();
          onMenu(e);
        }}
      >
        <IconMore width={15} height={15} />
      </button>
    </div>
  );
}

function RenameModal({
  current,
  onCancel,
  onSubmit,
}: {
  current: string;
  onCancel: () => void;
  onSubmit: (next: string) => void;
}) {
  const [value, setValue] = useState(current);
  useEscape(onCancel);
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form
        className="modal"
        style={{ width: 420 }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSubmit(value.trim());
        }}
      >
        <div className="modal-header"><h2>Rename branch</h2></div>
        <div className="modal-body">
          <div className="form-group">
            <label>New name</label>
            <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!value.trim() || value === current}>
            Rename
          </button>
        </div>
      </form>
    </div>
  );
}

export default function RefSidebar() {
  const {
    activeRepo,
    refs,
    status,
    commits,
    runAction,
    toast,
  } = useApp();
  const confirm = useConfirm();
  const { widthStyle: sidebarStyle, separatorProps: sidebarSeparator } = useResizable({
    prefKey: 'sidebarWidth',
    initial: 240,
    min: 180,
    max: 420,
    edge: 'right',
    label: 'Resize reference sidebar',
  });
  const [showNew, setShowNew] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [rename, setRename] = useState<RenameState | null>(null);
  const [stashList, setStashList] = useState<StashEntry[]>([]);
  const [stashView, setStashView] = useState<{ index: number; subject: string; diff: string } | null>(null);
  const [tagView, setTagView] = useState<TagDetail | null>(null);
  const [upstreamPicker, setUpstreamPicker] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const defaultGroups = { local: true, remote: true, tag: true, stash: true };
  const [openGroups, setOpenGroups] = useState(() =>
    activeRepo
      ? getPref(repoPref(activeRepo, 'refGroups'), defaultGroups)
      : defaultGroups);

  // Restore the collapsed/expanded state when switching repositories.
  useEffect(() => {
    if (!activeRepo) return;
    setOpenGroups(getPref(repoPref(activeRepo, 'refGroups'), defaultGroups));
  }, [activeRepo]);

  type BranchSort = 'default' | 'name' | 'recent';
  const [pinned, setPinned] = useState<string[]>(() =>
    activeRepo ? getPref(repoPref(activeRepo, 'pinnedBranches'), []) : []);
  const [branchSort, setBranchSort] = useState<BranchSort>(() =>
    activeRepo ? getPref(repoPref(activeRepo, 'branchSort'), 'default') : 'default');

  // Restore pinning and sort order when switching repositories.
  useEffect(() => {
    if (!activeRepo) return;
    setPinned(getPref(repoPref(activeRepo, 'pinnedBranches'), []));
    setBranchSort(getPref(repoPref(activeRepo, 'branchSort'), 'default'));
  }, [activeRepo]);

  function togglePin(branch: string) {
    const next = pinned.includes(branch) ? pinned.filter((b) => b !== branch) : [...pinned, branch];
    setPinned(next);
    if (activeRepo) setPref(repoPref(activeRepo, 'pinnedBranches'), next);
  }

  function changeSort(next: BranchSort) {
    setBranchSort(next);
    if (activeRepo) setPref(repoPref(activeRepo, 'branchSort'), next);
  }

  useEscape(() => {
    setStashView(null); setTagView(null); setUpstreamPicker(null);
  });

  const groups = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const match = (r: Ref) => !term || r.shortName.toLowerCase().includes(term);
    const local = refs.filter((r) => r.name.startsWith('refs/heads/') && match(r));
    const remote = refs.filter(
      (r) => r.name.startsWith('refs/remotes/') && !r.name.endsWith('/HEAD') && match(r),
    );
    const tags = refs.filter((r) => r.name.startsWith('refs/tags/') && match(r));
    return { local, remote, tags };
  }, [refs, filter]);

  const visibleStash = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return term ? stashList.filter((s) => s.subject.toLowerCase().includes(term)) : stashList;
  }, [stashList, filter]);

  // Tip-commit date per branch, used for the "recently committed" sort.
  const tipDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of commits) map.set(c.hash, new Date(c.date).getTime());
    return map;
  }, [commits]);

  // Apply pinning and the chosen sort order to local branches.
  const orderedLocal = useMemo(() => {
    const pinnedSet = new Set(pinned);
    const pinnedRows = groups.local.filter((r) => pinnedSet.has(r.shortName));
    const rest = groups.local.filter((r) => !pinnedSet.has(r.shortName));
    if (branchSort === 'name') {
      rest.sort((a, b) => a.shortName.localeCompare(b.shortName));
    } else if (branchSort === 'recent') {
      rest.sort((a, b) => (tipDate.get(b.hash) ?? 0) - (tipDate.get(a.hash) ?? 0));
    }
    return [...pinnedRows, ...rest];
  }, [groups.local, pinned, branchSort, tipDate]);

  const currentBranch = status?.branch;
  const rebaseInProgress = !!status?.state?.rebaseInProgress;
  // Prefer the explicit operation state; fall back to unmerged-file detection
  // for responses from older servers. Unmerged files during a rebase must not
  // surface the merge banner.
  const mergeInProgress = status?.state
    ? status.state.mergeInProgress
    : !!status?.files.some((f) => f.area === 'unmerged') && !rebaseInProgress;

  const loadStash = useCallback(async () => {
    if (!activeRepo) return;
    try {
      const res = await getStashList(activeRepo);
      setStashList(res.entries);
    } catch {
      setStashList([]);
    }
  }, [activeRepo]);

  useEffect(() => {
    loadStash();
  }, [loadStash, refs]);

  async function handleDelete(branch: string) {
    const ok = await confirm(
      `Delete branch ${branch}?`,
      'A safe delete (-d) is attempted first; if unmerged, you can force it.',
    );
    if (!ok) return;
    const result = await runAction(deleteBranch(activeRepo!, branch, false));
    if (result === null) {
      const force = await confirm(`Force delete ${branch}?`, 'Unmerged work will be lost.');
      if (force) await runAction(deleteBranch(activeRepo!, branch, true), `Deleted ${branch}`);
    }
  }

  const openMenu = (e: React.MouseEvent, kind: MenuKind, name: string, stashIndex?: number) => {
    setMenu({ x: e.clientX, y: e.clientY, kind, name, stashIndex });
  };

  const menuItems = useMemo<MenuItem[]>(() => {
    if (!menu) return [];
    if (menu.kind === 'local') {
      const isCurrent = menu.name === currentBranch;
      const isPinned = pinned.includes(menu.name);
      return [
        { id: 'checkout', label: 'Checkout', icon: <IconDownload width={15} height={15} />, disabled: isCurrent },
        { id: 'rename', label: 'Rename', icon: <IconEdit width={15} height={15} />, disabled: !isCurrent },
        { id: isPinned ? 'unpin' : 'pin', label: isPinned ? 'Unpin' : 'Pin to top', icon: <IconPin width={15} height={15} /> },
        { separator: true },
        { id: 'merge', label: 'Merge into current', icon: <IconMerge width={15} height={15} />, disabled: isCurrent },
        { id: 'push', label: 'Push to origin', icon: <IconUpload width={15} height={15} /> },
        { id: 'set-upstream', label: 'Set upstream…', icon: <IconBranch width={15} height={15} /> },
        { separator: true },
        { id: 'delete', label: 'Delete', icon: <IconTrash width={15} height={15} />, danger: true, disabled: isCurrent },
      ];
    }
    if (menu.kind === 'remote') {
      return [
        { id: 'checkout', label: 'Checkout as tracking branch', icon: <IconDownload width={15} height={15} /> },
        { separator: true },
        { id: 'delete-remote', label: 'Delete remote branch', icon: <IconTrash width={15} height={15} />, danger: true },
      ];
    }
    if (menu.kind === 'tag') {
      return [
        { id: 'tag-details', label: 'View details', icon: <IconEye width={15} height={15} /> },
        { id: 'checkout', label: 'Checkout (detached)', icon: <IconDownload width={15} height={15} /> },
        { id: 'push-tag', label: 'Push tag to origin', icon: <IconUpload width={15} height={15} /> },
        { id: 'delete-remote-tag', label: 'Delete remote tag', icon: <IconTrash width={15} height={15} />, danger: true },
        { separator: true },
        { id: 'delete-tag', label: 'Delete tag', icon: <IconTrash width={15} height={15} />, danger: true },
      ];
    }
    return [
      { id: 'view', label: 'View changes', icon: <IconEye width={15} height={15} /> },
      { separator: true },
      { id: 'apply', label: 'Apply', icon: <IconDownload width={15} height={15} /> },
      { id: 'pop', label: 'Pop (apply and drop)', icon: <IconMerge width={15} height={15} /> },
      { separator: true },
      { id: 'drop', label: 'Drop', icon: <IconTrash width={15} height={15} />, danger: true },
    ];
  }, [menu, currentBranch, pinned]);

  const onMenuSelect = async (id: string) => {
    if (!menu || !activeRepo) return;
    const { kind, name } = menu;
    setMenu(null);
    if (kind === 'local') {
      if (id === 'checkout') await runAction(checkoutRef(activeRepo, name), `Checked out ${name}`);
      else if (id === 'pin' || id === 'unpin') togglePin(name);
      else if (id === 'rename') setRename({ name, value: name });
      else if (id === 'merge') setMergeTarget(name);
      else if (id === 'push') await runAction(pushBranch(activeRepo, name), `Pushed ${name}`);
      else if (id === 'set-upstream') setUpstreamPicker(name);
      else if (id === 'delete') await handleDelete(name);
    } else if (kind === 'remote') {
      if (id === 'checkout') await runAction(checkoutRef(activeRepo, name), `Checked out ${name}`);
      else if (id === 'delete-remote') {
        const branch = name.includes('/') ? name.slice(name.indexOf('/') + 1) : name;
        const ok = await confirm(`Delete remote branch ${name}?`, 'This affects the shared remote.');
        if (ok) await runAction(deleteRemoteBranch(activeRepo, branch), `Deleted remote ${name}`);
      }
    } else if (kind === 'tag') {
      if (id === 'tag-details') {
        try {
          const res = await getTagShow(activeRepo, name);
          setTagView(res.tag);
        } catch (err: any) {
          toast(err.message, 'error');
        }
      } else if (id === 'checkout') await runAction(checkoutRef(activeRepo, name), `Checked out ${name}`);
      else if (id === 'push-tag') await runAction(pushTag(activeRepo, name), `Pushed tag ${name}`);
      else if (id === 'delete-tag') {
        const ok = await confirm(`Delete tag ${name}?`);
        if (ok) await runAction(deleteTag(activeRepo, name), `Deleted tag ${name}`);
      } else if (id === 'delete-remote-tag') {
        const ok = await confirm(
          `Delete remote tag ${name}?`,
          'This affects the shared remote. The local tag is kept.',
        );
        if (ok) await runAction(deleteRemoteTag(activeRepo, name), `Deleted remote tag ${name}`);
      }
    } else if (kind === 'stash') {
      const idx = menu.stashIndex ?? 0;
      if (id === 'view') {
        try {
          const res = await getStashShow(activeRepo, idx);
          setStashView({ index: idx, subject: name, diff: res.diff });
        } catch (err: any) {
          toast(err.message, 'error');
        }
      } else if (id === 'apply') await runAction(stashApply(activeRepo, idx, false), 'Stash applied');
      else if (id === 'pop') await runAction(stashApply(activeRepo, idx, true), 'Stash popped');
      else if (id === 'drop') {
        const ok = await confirm('Drop this stash?');
        if (ok) {
          await runAction(stashDrop(activeRepo, idx), 'Stash dropped');
          loadStash();
        }
      }
    }
  };

  const toggle = (key: keyof typeof openGroups) => {
    const next = { ...openGroups, [key]: !openGroups[key] };
    setOpenGroups(next);
    if (activeRepo) setPref(repoPref(activeRepo, 'refGroups'), next);
  };

  return (
    <aside className="sidebar" style={sidebarStyle}>
      <button type="button" className="col-resize" {...sidebarSeparator} />
      {rebaseInProgress && (
        <div className="merge-banner rebase-banner">
          <span className="merge-banner-msg">Rebase in progress — resolve conflicts, then continue or abort</span>
          <div className="banner-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => runAction(continueRebase(activeRepo!), 'Rebase continued')}
            >
              Continue rebase
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => runAction(abortRebase(activeRepo!), 'Rebase aborted')}
            >
              Abort rebase
            </button>
          </div>
        </div>
      )}
      {mergeInProgress && (
        <div className="merge-banner">
          <span className="merge-banner-msg">Merge in progress — resolve conflicts or abort</span>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => runAction(abortMerge(activeRepo!), 'Merge aborted')}
          >
            Abort merge
          </button>
        </div>
      )}
      <div className="sidebar-filter">
        <IconSearch width={13} height={13} />
        <input
          type="text"
          placeholder="Filter refs…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <GroupHead
        label="Local branches"
        count={groups.local.length}
        open={openGroups.local}
        onToggle={() => toggle('local')}
        action={(
          <>
            <select
              className="branch-sort"
              title="Sort local branches"
              value={branchSort}
              onChange={(e) => changeSort(e.target.value as BranchSort)}
            >
              <option value="default">Default</option>
              <option value="name">Name</option>
              <option value="recent">Recent</option>
            </select>
            <button type="button" className="icon-btn" style={{ width: 24, height: 24 }} title="New branch" onClick={() => setShowNew(true)}>
              <IconPlus width={15} height={15} />
            </button>
          </>
        )}
      />
      {openGroups.local && orderedLocal.map((r: Ref) => (
        <Row
          key={r.name}
          icon={<IconBranch width={15} height={15} />}
          name={r.shortName}
          current={r.shortName === currentBranch}
          badge={
            <>
              {pinned.includes(r.shortName) && (
                <span className="pin-badge" title="Pinned"><IconPin width={12} height={12} /></span>
              )}
              {(r.ahead > 0 || r.behind > 0) && (
                <span className="track-badge">
                  {r.ahead > 0 && <span className="track-ahead">↑{r.ahead}</span>}
                  {r.behind > 0 && <span className="track-behind">↓{r.behind}</span>}
                </span>
              )}
            </>
          }
          onOpen={() => {
            if (r.shortName !== currentBranch) {
              runAction(checkoutRef(activeRepo!, r.shortName), `Checked out ${r.shortName}`);
            }
          }}
          onMenu={(e) => openMenu(e, 'local', r.shortName)}
        />
      ))}

      <GroupHead
        label="Remote branches"
        count={groups.remote.length}
        open={openGroups.remote}
        onToggle={() => toggle('remote')}
      />
      {openGroups.remote && groups.remote.map((r: Ref) => (
        <Row
          key={r.name}
          icon={<IconBranch width={15} height={15} />}
          name={r.shortName}
          onOpen={() => runAction(checkoutRef(activeRepo!, r.shortName), `Checked out ${r.shortName}`)}
          onMenu={(e) => openMenu(e, 'remote', r.shortName)}
        />
      ))}

      <GroupHead
        label="Tags"
        count={groups.tags.length}
        open={openGroups.tag}
        onToggle={() => toggle('tag')}
      />
      {openGroups.tag && groups.tags.map((r: Ref) => (
        <Row
          key={r.name}
          icon={<IconTag width={15} height={15} />}
          name={r.shortName}
          onOpen={() => runAction(checkoutRef(activeRepo!, r.shortName), `Checked out ${r.shortName}`)}
          onMenu={(e) => openMenu(e, 'tag', r.shortName)}
        />
      ))}

      <GroupHead
        label="Stash"
        count={visibleStash.length}
        open={openGroups.stash}
        onToggle={() => toggle('stash')}
      />
      {openGroups.stash && visibleStash.map((entry) => (
        <Row
          key={entry.selector}
          icon={<IconStash width={15} height={15} />}
          name={entry.subject}
          onOpen={() => runAction(stashApply(activeRepo!, entry.index, false), 'Stash applied')}
          onMenu={(e) => openMenu(e, 'stash', entry.subject, entry.index)}
        />
      ))}

      {showNew && activeRepo && (
        <NewBranchModal repo={activeRepo} onClose={() => setShowNew(false)} />
      )}
      {mergeTarget && activeRepo && currentBranch && (
        <MergeModal
          sourceRef={mergeTarget}
          currentBranch={currentBranch}
          onClose={() => setMergeTarget(null)}
        />
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          title={menu.name}
          items={menuItems}
          onSelect={onMenuSelect}
          onClose={() => setMenu(null)}
        />
      )}
      {rename && (
        <RenameModal
          current={rename.value}
          onCancel={() => setRename(null)}
          onSubmit={(next) => {
            const old = rename.name;
            setRename(null);
            runAction(renameBranch(activeRepo!, old, next), `Renamed to ${next}`);
          }}
        />
      )}

      {stashView && (
        <div className="modal-backdrop" onClick={() => setStashView(null)}>
          <div
            className="modal"
            style={{ width: '86vw', height: '82vh', display: 'flex', flexDirection: 'column' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>stash@{stashView.index} — {stashView.subject}</h2>
              <button type="button" className="icon-btn" aria-label="Close stash" title="Close" onClick={() => setStashView(null)}>
                <IconX />
              </button>
            </div>
            <pre className="diff stash-diff" style={{ flex: 1, minHeight: 0, overflow: 'auto', margin: 0 }}>
              {stashView.diff.split('\n').map((line, i) => (
                <div
                  key={i}
                  className={`patch-line${
                    line.startsWith('+++') || line.startsWith('---') ? ' patch-meta'
                      : line.startsWith('+') ? ' patch-add'
                        : line.startsWith('-') ? ' patch-del'
                          : line.startsWith('@@') ? ' patch-hunk' : ''
                  }`}
                >
                  {line || ' '}
                </div>
              ))}
            </pre>
          </div>
        </div>
      )}

      {tagView && (
        <div className="modal-backdrop" onClick={() => setTagView(null)}>
          <div className="modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{tagView.tag}</h2>
              <button type="button" className="icon-btn" aria-label="Close tag" title="Close" onClick={() => setTagView(null)}>
                <IconX />
              </button>
            </div>
            <div className="modal-body">
              <div className="tag-detail-grid">
                <span className="detail-label">Tagger</span>
                <span className="detail-value">{tagView.tagger}</span>
                <span className="detail-label">Email</span>
                <span className="detail-value muted">{tagView.taggerEmail}</span>
                <span className="detail-label">Date</span>
                <span className="detail-value muted">
                  {new Date(tagView.time * 1000).toLocaleString()}
                </span>
                <span className="detail-label">Target</span>
                <span className="detail-value mono-small">{tagView.object}</span>
              </div>
              <div className="tag-message">
                <div className="detail-label" style={{ marginBottom: 6 }}>Message</div>
                <div className="tag-subject">{tagView.subject}</div>
                {tagView.body && <div className="tag-body muted">{tagView.body}</div>}
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-primary" onClick={() => setTagView(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {upstreamPicker && (
        <div className="modal-backdrop" onClick={() => setUpstreamPicker(null)}>
          <div className="modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Set upstream for {upstreamPicker}</h2>
              <button type="button" className="icon-btn" aria-label="Close upstream picker" title="Close" onClick={() => setUpstreamPicker(null)}>
                <IconX />
              </button>
            </div>
            <div className="modal-body">
              {groups.remote.length === 0 ? (
                <div className="list-empty">No remote tracking branches available.</div>
              ) : (
                <div className="pr-detail-list">
                  {groups.remote.map((r) => (
                    <button
                      key={r.name}
                      type="button"
                      className="pr-detail-item"
                      style={{ width: '100%', textAlign: 'left' }}
                      onClick={() => runAction(
                        setBranchUpstream(activeRepo!, r.shortName, upstreamPicker),
                        `Upstream set to ${r.shortName}`,
                      ).then((res) => { if (res !== null) setUpstreamPicker(null); })}
                    >
                      {r.shortName}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
