import { useApp } from './app-state';
import { useFocusTrap } from './hooks/use-focus-trap';
import { useShortcuts } from './hooks/use-shortcuts';
import CommandPalette from './components/CommandPalette';
import CommitDetail from './components/CommitDetail';
import CommitGraph from './components/CommitGraph';
import { IconFolder } from './components/icons';
import PrBoard from './components/PrBoard';
import RefSidebar from './components/RefSidebar';
import Toolbar from './components/Toolbar';
import WorkPanel from './components/WorkPanel';

function EmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-icon"><IconFolder width={28} height={28} /></div>
      <h3>No repository selected</h3>
      <p>Use the repository selector in the toolbar to register, clone or initialise a repository.</p>
    </div>
  );
}

function LoadingPanel() {
  return (
    <div className="loading-panel">
      <span className="spinner" />
      <span>Loading repository…</span>
    </div>
  );
}

export default function App() {
  const { activeRepo, view, repoLoading, status, commits } = useApp();
  useShortcuts();
  useFocusTrap();
  const firstLoad = repoLoading && !status && commits.length === 0;
  return (
    <div className="app">
      <Toolbar />
      {repoLoading && <div className="loading-bar" />}
      {!activeRepo ? (
        <EmptyState />
      ) : firstLoad ? (
        <LoadingPanel />
      ) : view === 'pr' ? (
        <PrBoard />
      ) : (
        <div className="main">
          <RefSidebar />
          <div className="center">
            <CommitGraph />
            <WorkPanel />
          </div>
          <CommitDetail />
        </div>
      )}
      <CommandPalette />
    </div>
  );
}
