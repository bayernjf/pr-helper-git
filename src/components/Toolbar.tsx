import { useState } from 'react';
import {
  fetchRepo,
  pullRepo,
  pushRepo,
  stashCreate,
} from '../api';
import { useApp } from '../app-state';
import AddRepoModal from './AddRepoModal';
import SettingsModal from './SettingsModal';
import {
  IconDownload,
  IconGear,
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

  const branchLabel = activeBrief?.branch
    ? activeBrief.branch
    : activeRepo
      ? 'detached HEAD'
      : 'no repository';

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
        className="btn"
        disabled={!activeRepo || busy}
        title="git stash push"
        onClick={() => runAction(stashCreate(activeRepo!), 'Stashed')}
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
        title="GitHub settings"
        onClick={() => setShowSettings(true)}
      >
        <IconGear />
      </button>

      {showAdd && <AddRepoModal onClose={() => setShowAdd(false)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </header>
  );
}
