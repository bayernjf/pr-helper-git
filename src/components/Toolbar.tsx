import { useEffect, useState } from 'react';
import {
  fetchRepo,
  pullRepo,
  pushRepo,
  type ForcePushMode,
} from '../api';
import { useApp } from '../app-state';
import AddRepoModal from './AddRepoModal';
import AuditModal from './AuditModal';
import CompareModal from './CompareModal';
import GrepModal from './GrepModal';
import GlobalGrepModal from './GlobalGrepModal';
import ReflogModal from './ReflogModal';
import RemoteModal from './RemoteModal';
import SettingsModal from './SettingsModal';
import StashModal from './StashModal';
import { ContextMenu, type MenuItem } from './context-menu';
import { useConfirm } from './ui';
import {
  IconAudit,
  IconChevronDown,
  IconClock,
  IconDownload,
  IconGear,
  IconGlobe,
  IconSearch,
  IconServer,
  IconSplit,
  IconStash,
  IconUpload,
} from './icons';

export default function Toolbar() {
  const {
    repos,
    activeRepo,
    activeBrief,
    view,
    busy,
    selectRepo,
    setView,
    runAction,
  } = useApp();
  const [showAdd, setShowAdd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showRemotes, setShowRemotes] = useState(false);
  const [showStash, setShowStash] = useState(false);
  const [showReflog, setShowReflog] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [showGrep, setShowGrep] = useState(false);
  const [showGlobalGrep, setShowGlobalGrep] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [dropMenu, setDropMenu] = useState<{ x: number; y: number; kind: 'pull' | 'push' } | null>(null);
  const confirm = useConfirm();

  // The command palette opens these dialogs via lightweight custom events.
  useEffect(() => {
    const openAdd = () => setShowAdd(true);
    const openSettings = () => setShowSettings(true);
    const openRemotes = () => setShowRemotes(true);
    const openReflog = () => setShowReflog(true);
    const openStash = () => setShowStash(true);
    const openCompare = () => setShowCompare(true);
    const openGrep = () => setShowGrep(true);
    const openAudit = () => setShowAudit(true);
    window.addEventListener('git2:add-repo', openAdd);
    window.addEventListener('git2:settings', openSettings);
    window.addEventListener('git2:remotes', openRemotes);
    window.addEventListener('git2:reflog', openReflog);
    window.addEventListener('git2:stash', openStash);
    window.addEventListener('git2:compare', openCompare);
    window.addEventListener('git2:grep', openGrep);
    window.addEventListener('git2:audit', openAudit);
    return () => {
      window.removeEventListener('git2:add-repo', openAdd);
      window.removeEventListener('git2:settings', openSettings);
      window.removeEventListener('git2:remotes', openRemotes);
      window.removeEventListener('git2:reflog', openReflog);
      window.removeEventListener('git2:stash', openStash);
      window.removeEventListener('git2:compare', openCompare);
      window.removeEventListener('git2:grep', openGrep);
      window.removeEventListener('git2:audit', openAudit);
    };
  }, []);

  const branchLabel = activeBrief?.branch
    ? activeBrief.branch
    : activeRepo
      ? 'detached HEAD'
      : 'no repository';

  const menuItems: MenuItem[] = dropMenu?.kind === 'pull'
    ? [
      { id: 'pull-merge', label: 'Pull (merge)' },
      { id: 'pull-rebase', label: 'Pull with rebase' },
    ]
    : [
      { id: 'push-normal', label: 'Push' },
      { id: 'push-lease', label: 'Force push (--force-with-lease)' },
      { id: 'push-force', label: 'Force push (--force)', danger: true },
    ];

  async function onMenuSelect(id: string) {
    setDropMenu(null);
    if (!activeRepo) return;
    if (id === 'pull-merge') await runAction(pullRepo(activeRepo, false), 'Pulled');
    else if (id === 'pull-rebase') await runAction(pullRepo(activeRepo, true), 'Pulled with rebase');
    else if (id === 'push-normal') await runAction(pushRepo(activeRepo), 'Pushed');
    else if (id === 'push-lease' || id === 'push-force') {
      const mode: ForcePushMode = id === 'push-lease' ? 'force-with-lease' : 'force';
      const ok = await confirm(
        `Force push (${mode})?`,
        mode === 'force'
          ? 'This overwrites the remote ref and can discard others\' commits. Prefer force-with-lease.'
          : 'This updates the remote only if nobody else pushed in the meantime.',
      );
      if (ok) await runAction(pushRepo(activeRepo, false, mode, true), 'Force pushed');
    }
  }

  function openMenu(event: React.MouseEvent, kind: 'pull' | 'push') {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setDropMenu({ x: rect.left, y: rect.bottom + 4, kind });
  }

  return (
    <header className="toolbar">
      <select
        className="repo-select"
        value={activeRepo || ''}
        onChange={(e) => {
          if (e.target.value === '__add__') {
            setShowAdd(true);
            e.target.value = activeRepo || '';
          } else {
            selectRepo(e.target.value);
          }
        }}
      >
        {repos.length === 0 && <option value="">No repository</option>}
        {repos.map((r) => (
          <option key={r.path} value={r.path}>{r.name}</option>
        ))}
        <option value="__add__">+ Add repository…</option>
      </select>

      <span className="branch-pill" title={activeRepo || ''}>
        <span className="dot" />
        {branchLabel}
        {activeBrief && (activeBrief.ahead > 0 || activeBrief.behind > 0) && (
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, marginLeft: 2 }}>
            {activeBrief.ahead > 0 && <span style={{ color: 'var(--green)' }}>↑{activeBrief.ahead} </span>}
            {activeBrief.behind > 0 && <span style={{ color: 'var(--red)' }}>↓{activeBrief.behind}</span>}
          </span>
        )}
      </span>

      <span className="spacer" />

      <button
        type="button"
        className="btn"
        disabled={!activeRepo || busy}
        title="git fetch --all"
        onClick={() => runAction(fetchRepo(activeRepo!), 'Fetched')}
      >
        Fetch
      </button>
      <span className="btn-group">
        <button
          type="button"
          className="btn"
          disabled={!activeRepo || busy}
          title="git pull"
          onClick={() => runAction(pullRepo(activeRepo!), 'Pulled')}
        >
          <IconDownload width={14} height={14} />
          Pull
        </button>
        <button
          type="button"
          className="btn btn-caret"
          disabled={!activeRepo || busy}
          title="Pull options"
          onClick={(e) => openMenu(e, 'pull')}
        >
          <IconChevronDown width={12} height={12} />
        </button>
      </span>
      <span className="btn-group">
        <button
          type="button"
          className="btn"
          disabled={!activeRepo || busy}
          title="git push"
          onClick={() => runAction(pushRepo(activeRepo!), 'Pushed')}
        >
          <IconUpload width={14} height={14} />
          Push
        </button>
        <button
          type="button"
          className="btn btn-caret"
          disabled={!activeRepo || busy}
          title="Push options"
          onClick={(e) => openMenu(e, 'push')}
        >
          <IconChevronDown width={12} height={12} />
        </button>
      </span>
      <button
        type="button"
        className="btn"
        disabled={!activeRepo || busy}
        title="Stash working changes"
        onClick={() => setShowStash(true)}
      >
        <IconStash width={14} height={14} />
        Stash
      </button>

      <span className="segmented">
        <button
          type="button"
          className={view === 'git' ? 'active' : ''}
          onClick={() => setView('git')}
        >
          Git
        </button>
        <button
          type="button"
          className={view === 'pr' ? 'active' : ''}
          onClick={() => setView('pr')}
        >
          Pull Requests
        </button>
      </span>
      <button
        type="button"
        className="icon-btn"
        title="Search repository contents (git grep)"
        disabled={!activeRepo}
        onClick={() => setShowGrep(true)}
      >
        <IconSearch />
      </button>
      <button
        type="button"
        className="icon-btn"
        title="Search across all repositories"
        onClick={() => setShowGlobalGrep(true)}
      >
        <IconGlobe />
      </button>
      <button
        type="button"
        className="icon-btn"
        title="Compare two references"
        disabled={!activeRepo}
        onClick={() => setShowCompare(true)}
      >
        <IconSplit />
      </button>
      <button
        type="button"
        className="icon-btn"
        title="View reference log (reflog)"
        disabled={!activeRepo}
        onClick={() => setShowReflog(true)}
      >
        <IconClock />
      </button>
      <button
        type="button"
        className="icon-btn"
        title="Manage remotes"
        disabled={!activeRepo}
        onClick={() => setShowRemotes(true)}
      >
        <IconServer />
      </button>
      <button
        type="button"
        className="icon-btn"
        title="View audit log"
        onClick={() => setShowAudit(true)}
      >
        <IconAudit />
      </button>
      <button
        type="button"
        className="icon-btn"
        title="GitHub settings"
        onClick={() => setShowSettings(true)}
      >
        <IconGear />
      </button>

      {showAdd && <AddRepoModal onClose={() => setShowAdd(false)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showRemotes && <RemoteModal onClose={() => setShowRemotes(false)} />}
      {showStash && <StashModal onClose={() => setShowStash(false)} />}
      {showReflog && <ReflogModal onClose={() => setShowReflog(false)} />}
      {showCompare && <CompareModal onClose={() => setShowCompare(false)} />}
      {showGrep && <GrepModal onClose={() => setShowGrep(false)} />}
      {showGlobalGrep && <GlobalGrepModal onClose={() => setShowGlobalGrep(false)} />}
      {showAudit && <AuditModal onClose={() => setShowAudit(false)} />}
      {dropMenu && (
        <ContextMenu
          x={dropMenu.x}
          y={dropMenu.y}
          items={menuItems}
          onSelect={onMenuSelect}
          onClose={() => setDropMenu(null)}
        />
      )}
    </header>
  );
}
