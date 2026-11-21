import { useEffect, useRef, useState } from 'react';
import {
  fetchRepo,
  pullRepo,
  pushRepo,
  type ForcePushMode,
} from '../api';
import { usePreferences, useRepoData, useRunAction, useBusy } from '../app-state/hooks';
import AddRepoModal from './AddRepoModal';
import AuditModal from './AuditModal';
import CommitSearchModal from './CommitSearchModal';
import CompareModal from './CompareModal';
import ConfigModal from './ConfigModal';
import GrepModal from './GrepModal';
import GlobalGrepModal from './GlobalGrepModal';
import BisectModal from './BisectModal';
import ReflogModal from './ReflogModal';
import RemoteModal from './RemoteModal';
import RepositoriesModal from './RepositoriesModal';

declare global {
  interface Window {
    // The desktop shell may open a folder before React has attached its
    // listener; this one-shot handoff survives that tiny startup window.
    __prHelperGitPendingOpenPath?: string;
  }
}
import SettingsModal from './SettingsModal';
import ShortcutsHelp from './ShortcutsHelp';
import StashModal from './StashModal';
import TeamModal from './TeamModal';
import { ContextMenu, type MenuItem } from './context-menu';

type DropKind = 'pull' | 'push' | 'more';
import { useConfirm } from './ui';
import { t, tp } from '../i18n';
import {
  IconAudit,
  IconChevronDown,
  IconClock,
  IconDownload,
  IconGear,
  IconGlobe,
  IconKeyboard,
  IconMonitor,
  IconMoon,
  IconPanel,
  IconMore,
  IconSearch,
  IconServer,
  IconSliders,
  IconSplit,
  IconStash,
  IconSun,
  IconUpload,
  IconUser,
} from './icons';

export default function Toolbar() {
  const { activeRepo, activeBrief } = useRepoData();
  const { view, theme, setView, toggleTheme, sidebarCollapsed, setSidebarCollapsed } = usePreferences();
  const busy = useBusy();
  const { runAction } = useRunAction();
  const [showAdd, setShowAdd] = useState(false);
  const [addRepoPath, setAddRepoPath] = useState('');
  const [showRepositories, setShowRepositories] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showRemotes, setShowRemotes] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [showStash, setShowStash] = useState(false);
  const [showReflog, setShowReflog] = useState(false);
  const [showBisect, setShowBisect] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [showGrep, setShowGrep] = useState(false);
  const [showCommitSearch, setShowCommitSearch] = useState(false);
  const [showGlobalGrep, setShowGlobalGrep] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [showTeam, setShowTeam] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [dropMenu, setDropMenu] = useState<{ x: number; y: number; kind: DropKind } | null>(null);
  const confirm = useConfirm();

  // The command palette opens these dialogs via lightweight custom events.
  useEffect(() => {
    const openAdd = (event?: Event) => {
      const detail = event instanceof CustomEvent
        ? (event.detail as { path?: string } | undefined)
        : undefined;
      window.__prHelperGitPendingOpenPath = undefined;
      setAddRepoPath(detail?.path ?? '');
      setShowAdd(true);
    };
    const openRepositories = () => setShowRepositories(true);
    const openSettings = () => setShowSettings(true);
    const openRemotes = () => setShowRemotes(true);
    const openReflog = () => setShowReflog(true);
    const openBisect = () => setShowBisect(true);
    const openStash = () => setShowStash(true);
    const openCompare = () => setShowCompare(true);
    const openGrep = () => setShowGrep(true);
    const openCommitSearch = () => setShowCommitSearch(true);
    const openAudit = () => setShowAudit(true);
    const openShortcuts = () => setShowShortcuts(true);
    const openConfig = () => setShowConfig(true);
    const openTeam = () => setShowTeam(true);
    const openGlobalGrep = () => setShowGlobalGrep(true);
    window.addEventListener('git2:add-repo', openAdd);
    window.addEventListener('git2:repositories', openRepositories);
    window.addEventListener('git2:settings', openSettings);
    window.addEventListener('git2:remotes', openRemotes);
    window.addEventListener('git2:reflog', openReflog);
    window.addEventListener('git2:bisect', openBisect);
    window.addEventListener('git2:stash', openStash);
    window.addEventListener('git2:compare', openCompare);
    window.addEventListener('git2:grep', openGrep);
    window.addEventListener('git2:search-commits', openCommitSearch);
    window.addEventListener('git2:audit', openAudit);
    window.addEventListener('git2:shortcuts', openShortcuts);
    window.addEventListener('git2:config', openConfig);
    window.addEventListener('git2:team', openTeam);
    window.addEventListener('git2:global-grep', openGlobalGrep);

    // A desktop folder pick can land before this effect runs. Consume it once
    // after listeners are attached; later picks use the custom event.
    const pendingOpenPath = window.__prHelperGitPendingOpenPath;
    if (pendingOpenPath) {
      window.__prHelperGitPendingOpenPath = undefined;
      setAddRepoPath(pendingOpenPath);
      setShowAdd(true);
    }

    return () => {
      window.removeEventListener('git2:add-repo', openAdd);
      window.removeEventListener('git2:repositories', openRepositories);
      window.removeEventListener('git2:settings', openSettings);
      window.removeEventListener('git2:remotes', openRemotes);
      window.removeEventListener('git2:reflog', openReflog);
      window.removeEventListener('git2:bisect', openBisect);
      window.removeEventListener('git2:stash', openStash);
      window.removeEventListener('git2:compare', openCompare);
      window.removeEventListener('git2:grep', openGrep);
      window.removeEventListener('git2:search-commits', openCommitSearch);
      window.removeEventListener('git2:audit', openAudit);
      window.removeEventListener('git2:shortcuts', openShortcuts);
      window.removeEventListener('git2:config', openConfig);
      window.removeEventListener('git2:team', openTeam);
      window.removeEventListener('git2:global-grep', openGlobalGrep);
    };
  }, []);

  const branchLabel = activeBrief?.branch
    ? activeBrief.branch
    : activeRepo
      ? 'detached HEAD'
      : 'no repository';

  function menuItemsFor(kind: DropKind): MenuItem[] {
    switch (kind) {
      case 'pull':
        return [
          { id: 'pull-merge', label: t('Pull (merge)') },
          { id: 'pull-rebase', label: t('Pull with rebase') },
        ];
      case 'push':
        return [
          { id: 'push-normal', label: t('Push') },
          { id: 'push-lease', label: t('Force push (--force-with-lease)') },
          { id: 'push-force', label: t('Force push (--force)'), danger: true },
        ];
      case 'more':
        return [
          { id: 'grep', label: t('Search repository contents (git grep)'), icon: <IconSearch width={13} height={13} /> },
          { id: 'commit-search', label: t('Search commits in all branches'), icon: <IconClock width={13} height={13} /> },
          { id: 'global-grep', label: t('Search across all repositories'), icon: <IconGlobe width={13} height={13} /> },
          { id: 'compare', label: t('Compare two references'), icon: <IconSplit width={13} height={13} /> },
          { id: 'reflog', label: t('View reference log (reflog)'), icon: <IconClock width={13} height={13} /> },
          { id: 'remotes', label: t('Manage remotes'), icon: <IconServer width={13} height={13} /> },
          { id: 'config', label: t('Repository settings (git config)'), icon: <IconSliders width={13} height={13} /> },
          { id: 'audit', label: t('View audit log'), icon: <IconAudit width={13} height={13} /> },
          { id: 'team', label: t('Team members and configuration'), icon: <IconUser width={13} height={13} /> },
          { id: 'shortcuts', label: t('Keyboard shortcuts (press ?)'), icon: <IconKeyboard width={13} height={13} /> },
        ];
    }
  }

  const menuItems: MenuItem[] = dropMenu ? menuItemsFor(dropMenu.kind) : [];

  async function onMenuSelect(id: string) {
    setDropMenu(null);
    // Repo-independent surfaces open regardless of the active repository.
    if (id === 'team') { setShowTeam(true); return; }
    if (id === 'shortcuts') { setShowShortcuts(true); return; }
    if (!activeRepo) return;
    if (id === 'grep') { setShowGrep(true); return; }
    if (id === 'commit-search') { setShowCommitSearch(true); return; }
    if (id === 'global-grep') { setShowGlobalGrep(true); return; }
    if (id === 'compare') { setShowCompare(true); return; }
    if (id === 'reflog') { setShowReflog(true); return; }
    if (id === 'remotes') { setShowRemotes(true); return; }
    if (id === 'config') { setShowConfig(true); return; }
    if (id === 'audit') { setShowAudit(true); return; }
    if (id === 'pull-merge') await runAction(pullRepo(activeRepo, false), 'Pulled');
    else if (id === 'pull-rebase') await runAction(pullRepo(activeRepo, true), 'Pulled with rebase');
    else if (id === 'push-normal') await runAction(pushRepo(activeRepo), 'Pushed');
    else if (id === 'push-lease' || id === 'push-force') {
      const mode: ForcePushMode = id === 'push-lease' ? 'force-with-lease' : 'force';
      const ok = await confirm(
        tp('Force push ({mode})?', { mode }),
        mode === 'force'
          ? t('This overwrites the remote ref and can discard other commits. Prefer force-with-lease.')
          : 'This updates the remote only if nobody else pushed in the meantime.',
      );
      if (ok) await runAction(pushRepo(activeRepo, false, mode, true), 'Force pushed');
    }
  }

  const suppressCaretClick = useRef(false);

  // One toggle contract for every menu caret: mousedown closes an open menu
  // (WebKit fires the portaled menu's onBlur with a null relatedTarget and
  // would close+reopen otherwise), the matching click is suppressed.
  const caretDown = (kind: DropKind) => () => {
    if (dropMenu?.kind === kind) {
      setDropMenu(null);
      suppressCaretClick.current = true;
    } else {
      suppressCaretClick.current = false;
    }
  };
  const caretClick = (event: React.MouseEvent, kind: DropKind) => {
    if (suppressCaretClick.current) {
      suppressCaretClick.current = false;
      return;
    }
    openMenu(event, kind);
  };

  function openMenu(event: React.MouseEvent, kind: DropKind) {
    // Toggle: the carets carry data-menu-trigger, so the open menu survived
    // this click's mousedown and a second click on the same caret closes it.
    if (dropMenu?.kind === kind) {
      setDropMenu(null);
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setDropMenu({ x: rect.left, y: rect.bottom + 4, kind });
  }

  return (
    <header className="toolbar">
      <button
        type="button"
        className="icon-btn"
        title={sidebarCollapsed ? t('Show sidebar (⌘B)') : t('Hide sidebar (⌘B)')}
        aria-label={sidebarCollapsed ? t('Show sidebar (⌘B)') : t('Hide sidebar (⌘B)')}
        aria-pressed={sidebarCollapsed}
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
      >
        <IconPanel width={15} height={15} />
      </button>
      <span className="branch-pill" title={activeRepo || ''}>
        <span className="dot" />
        {branchLabel}
        {activeBrief && (activeBrief.ahead > 0 || activeBrief.behind > 0) && (
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, marginLeft: 2 }}>
            {activeBrief.ahead > 0 && <span style={{ color: 'var(--green-strong)' }}>↑{activeBrief.ahead} </span>}
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
        <span className="btn-label">{t("Fetch")}</span>
      </button>
      <span className="btn-group">
        <button
          type="button"
          className="btn"
          disabled={!activeRepo || busy}
          aria-label={t("Pull")}
          onClick={() => runAction(pullRepo(activeRepo!), 'Pulled')}
        >
          <IconDownload width={14} height={14} />
          <span className="btn-label">{t("Pull")}</span>
        </button>
        <button
          type="button"
          className={`btn btn-caret${dropMenu?.kind === 'pull' ? ' open' : ''}`}
          disabled={!activeRepo || busy}
          aria-label={t("Pull options")}
          data-menu-trigger="pull"
          onMouseDown={caretDown('pull')}
        onClick={(e) => caretClick(e, 'pull')}
        >
          <IconChevronDown width={12} height={12} />
        </button>
      </span>
      <span className="btn-group">
        <button
          type="button"
          className="btn"
          disabled={!activeRepo || busy}
          aria-label={t("Push")}
          onClick={() => runAction(pushRepo(activeRepo!), 'Pushed')}
        >
          <IconUpload width={14} height={14} />
          <span className="btn-label">{t("Push")}</span>
        </button>
        <button
          type="button"
          className={`btn btn-caret${dropMenu?.kind === 'push' ? ' open' : ''}`}
          disabled={!activeRepo || busy}
          aria-label={t("Push options")}
          data-menu-trigger="push"
          onMouseDown={caretDown('push')}
        onClick={(e) => caretClick(e, 'push')}
        >
          <IconChevronDown width={12} height={12} />
        </button>
      </span>
      <button
        type="button"
        className="btn"
        disabled={!activeRepo || busy}
        title={t("Stash working changes")}
        onClick={() => setShowStash(true)}
      >
        <IconStash width={14} height={14} />
        <span className="btn-label">{t("Stash")}</span>
      </button>

      <span className="segmented">
        <button
          type="button"
          className={view === 'dashboard' ? 'active' : ''}
          onClick={() => setView('dashboard')}
        >
          {t('Dashboard')}
        </button>
        <button
          type="button"
          className={view === 'git' ? 'active' : ''}
          onClick={() => setView('git')}
        >
          {t('Git')}
        </button>
        <button
          type="button"
          className={view === 'pr' ? 'active' : ''}
          onClick={() => setView('pr')}
        >
          {t('Pull Requests')}
        </button>
        <button
          type="button"
          className={view === 'ci' ? 'active' : ''}
          onClick={() => setView('ci')}
        >
          {t('CI Health')}
        </button>
        <button
          type="button"
          className={view === 'flows' ? 'active' : ''}
          onClick={() => setView('flows')}
        >
          {t('Flows')}
        </button>
      </span>
      <span className="spacer" />
      <span className="toolbar-divider" />
      <button
        type="button"
        className="btn"
        data-menu-trigger="more"
        aria-label={t('More')}
        title={t('More')}
        onMouseDown={caretDown('more')}
        onClick={(e) => caretClick(e, 'more')}
      >
        <IconMore width={14} height={14} />
      </button>
      <button
        type="button"
        className="btn"
        title={t("GitHub settings")}
        aria-label={t("GitHub settings")}
        onClick={() => setShowSettings(true)}
      >
        <IconGear />
      </button>
      <button
        type="button"
        className="btn"
        title={theme === 'dark' ? t('Theme: dark (click for light)') : theme === 'light' ? t('Theme: light (click for system)') : t('Theme: system (click for dark)')}
        aria-label={theme === 'dark' ? t('Theme: dark (click for light)') : theme === 'light' ? t('Theme: light (click for system)') : t('Theme: system (click for dark)')}
        onClick={toggleTheme}
      >
        {theme === 'dark' ? <IconMoon /> : theme === 'light' ? <IconSun /> : <IconMonitor />}
      </button>

      {showAdd && (
        <AddRepoModal
          initialPath={addRepoPath}
          onClose={() => {
            setShowAdd(false);
            setAddRepoPath('');
          }}
        />
      )}
      {showRepositories && <RepositoriesModal onClose={() => setShowRepositories(false)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} activeRepo={activeRepo} />}
      {showRemotes && <RemoteModal onClose={() => setShowRemotes(false)} />}
      {showConfig && <ConfigModal onClose={() => setShowConfig(false)} />}
      {showStash && <StashModal onClose={() => setShowStash(false)} />}
      {showReflog && <ReflogModal onClose={() => setShowReflog(false)} />}
      {showBisect && <BisectModal onClose={() => setShowBisect(false)} />}
      {showCompare && <CompareModal onClose={() => setShowCompare(false)} />}
      {showGrep && <GrepModal onClose={() => setShowGrep(false)} />}
      {showCommitSearch && <CommitSearchModal onClose={() => setShowCommitSearch(false)} />}
      {showGlobalGrep && <GlobalGrepModal onClose={() => setShowGlobalGrep(false)} />}
      {showAudit && <AuditModal onClose={() => setShowAudit(false)} />}
      {showTeam && <TeamModal onClose={() => setShowTeam(false)} />}
      {showShortcuts && <ShortcutsHelp onClose={() => setShowShortcuts(false)} />}
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
