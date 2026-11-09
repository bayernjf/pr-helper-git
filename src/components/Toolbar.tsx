import { useEffect, useState } from 'react';
import {
  fetchRepo,
  pullRepo,
  pushRepo,
  type ForcePushMode,
} from '../api';
import { useApp } from '../app-state';
import AddRepoModal from './AddRepoModal';
import { Dropdown } from './Dropdown';
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
import SettingsModal from './SettingsModal';
import ShortcutsHelp from './ShortcutsHelp';
import StashModal from './StashModal';
import TeamModal from './TeamModal';
import { ContextMenu, type MenuItem } from './context-menu';
import { useConfirm } from './ui';
import { t } from '../i18n';
import {
  IconAudit,
  IconChevronDown,
  IconClock,
  IconDownload,
  IconGear,
  IconGlobe,
  IconKeyboard,
  IconList,
  IconMoon,
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
  const {
    repos,
    activeRepo,
    activeBrief,
    view,
    theme,
    busy,
    selectRepo,
    setView,
    toggleTheme,
    runAction,
  } = useApp();
  const [showAdd, setShowAdd] = useState(false);
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
  const [dropMenu, setDropMenu] = useState<{ x: number; y: number; kind: 'pull' | 'push' } | null>(null);
  const confirm = useConfirm();

  // The command palette opens these dialogs via lightweight custom events.
  useEffect(() => {
    const openAdd = () => setShowAdd(true);
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
    };
  }, []);

  const branchLabel = activeBrief?.branch
    ? activeBrief.branch
    : activeRepo
      ? 'detached HEAD'
      : 'no repository';

  const menuItems: MenuItem[] = dropMenu?.kind === 'pull'
    ? [
      { id: 'pull-merge', label: t('Pull (merge)') },
      { id: 'pull-rebase', label: t('Pull with rebase') },
    ]
    : [
      { id: 'push-normal', label: t('Push') },
      { id: 'push-lease', label: t('Force push (--force-with-lease)') },
      { id: 'push-force', label: t('Force push (--force)'), danger: true },
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
      <Dropdown
        className="repo-select"
        value={activeRepo || ''}
        onChange={(v) => {
          if (v === '__add__') {
            setShowAdd(true);
          } else {
            selectRepo(v);
          }
        }}
        options={[
          ...(repos.length === 0 ? [{ value: '', label: t('No repository') }] : []),
          ...repos.map((r) => ({ value: r.path, label: r.name })),
          { value: '__add__', label: t('+ Add repository…') },
        ]}
      />
      <button
        type="button"
        className="icon-btn"
        title={t("Open repositories panel")}
        aria-label={t("Open repositories panel")}
        onClick={() => setShowRepositories(true)}
      >
        <IconList />
      </button>

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
        {t("Fetch")}
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
          {t("Pull")}
        </button>
        <button
          type="button"
          className="btn btn-caret"
          disabled={!activeRepo || busy}
          title={t("Pull options")}
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
          {t("Push")}
        </button>
        <button
          type="button"
          className="btn btn-caret"
          disabled={!activeRepo || busy}
          title={t("Push options")}
          onClick={(e) => openMenu(e, 'push')}
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
        {t("Stash")}
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
        title={t("Search commits in all branches")}
        onClick={() => setShowCommitSearch(true)}
      >
        <IconClock />
      </button>
      <button
        type="button"
        className="icon-btn"
        title={t("Search across all repositories")}
        onClick={() => setShowGlobalGrep(true)}
      >
        <IconGlobe />
      </button>
      <button
        type="button"
        className="icon-btn"
        title={t("Compare two references")}
        disabled={!activeRepo}
        onClick={() => setShowCompare(true)}
      >
        <IconSplit />
      </button>
      <button
        type="button"
        className="icon-btn"
        title={t("View reference log (reflog)")}
        disabled={!activeRepo}
        onClick={() => setShowReflog(true)}
      >
        <IconClock />
      </button>
      <button
        type="button"
        className="icon-btn"
        title={t("Manage remotes")}
        disabled={!activeRepo}
        onClick={() => setShowRemotes(true)}
      >
        <IconServer />
      </button>
      <button
        type="button"
        className="icon-btn"
        title={t("Repository settings (git config)")}
        aria-label={t("Repository settings")}
        disabled={!activeRepo}
        onClick={() => setShowConfig(true)}
      >
        <IconSliders />
      </button>
      <button
        type="button"
        className="icon-btn"
        title={t("View audit log")}
        onClick={() => setShowAudit(true)}
      >
        <IconAudit />
      </button>
      <button
        type="button"
        className="icon-btn"
        title={t("Team members and configuration")}
        aria-label={t("Team")}
        onClick={() => setShowTeam(true)}
      >
        <IconUser />
      </button>
      <button
        type="button"
        className="icon-btn"
        title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        onClick={toggleTheme}
      >
        {theme === 'dark' ? <IconMoon /> : <IconSun />}
      </button>
      <button
        type="button"
        className="icon-btn"
        title={t("GitHub settings")}
        aria-label={t("GitHub settings")}
        onClick={() => setShowSettings(true)}
      >
        <IconGear />
      </button>
      <button
        type="button"
        className="icon-btn"
        title={t("Keyboard shortcuts (press ?)")}
        aria-label={t("Keyboard shortcuts")}
        onClick={() => setShowShortcuts(true)}
      >
        <IconKeyboard />
      </button>

      {showAdd && <AddRepoModal onClose={() => setShowAdd(false)} />}
      {showRepositories && <RepositoriesModal onClose={() => setShowRepositories(false)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
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
