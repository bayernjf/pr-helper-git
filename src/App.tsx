import { useApp } from './app-state';
import CommitDetail from './components/CommitDetail';
import CommitGraph from './components/CommitGraph';
import PrBoard from './components/PrBoard';
import RefSidebar from './components/RefSidebar';
import Toolbar from './components/Toolbar';
import WorkPanel from './components/WorkPanel';

function EmptyState() {
  return (
    <div className="empty-state">
      <h2>No repository selected</h2>
      <p>
        Use <strong>+ Add repository…</strong> in the toolbar to register a local
        Git repository.
      </p>
    </div>
  );
}

export default function App() {
  const { activeRepo, view } = useApp();
  return (
    <div className="app">
      <Toolbar />
      {!activeRepo ? (
        <EmptyState />
      ) : view === 'pr' ? (
        <PrBoard />
      ) : (
        <div className="workspace">
          <RefSidebar />
          <div className="center-pane">
            <CommitGraph />
            <WorkPanel />
          </div>
          <CommitDetail />
        </div>
      )}
    </div>
  );
}
