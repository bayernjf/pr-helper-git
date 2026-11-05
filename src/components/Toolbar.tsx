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
      <div className="toolbar-group">
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
            <option key={r.path} value={r.path}>
              {r.name}
            </option>
          ))}
          <option value="__add__">+ Add repository…</option>
        </select>
        <span className="branch-pill" title={activeRepo || ''}>
          <span className="branch-icon" />
          {branchLabel}
          {activeBrief && (activeBrief.ahead > 0 || activeBrief.behind > 0) && (
            <span className="ab-pill">
              {activeBrief.ahead > 0 && <span className="ahead">↑{activeBrief.ahead}</span>}
              {activeBrief.behind > 0 && <span className="behind">↓{activeBrief.behind}</span>}
            </span>
          )}
        </span>
      </div>

      <div className="toolbar-group">
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
          Pull
        </button>
        <button
          type="button"
          className="btn"
          disabled={!activeRepo || busy}
          title="git push"
          onClick={() => runAction(pushRepo(activeRepo!), 'Pushed')}
        >
          Push
        </button>
        <button
          type="button"
          className="btn"
          disabled={!activeRepo || busy}
          title="git stash push"
          onClick={() => runAction(stashCreate(activeRepo!), 'Stashed')}
        >
          Stash
        </button>
      </div>

      <div className="toolbar-group">
        <div className="view-switch">
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
        </div>
        <button
          type="button"
          className="btn btn-icon"
          title="GitHub settings"
          onClick={() => setShowSettings(true)}
        >
          ⚙
        </button>
      </div>

      {showAdd && <AddRepoModal onClose={() => setShowAdd(false)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </header>
  );
}
