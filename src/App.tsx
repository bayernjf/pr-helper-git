import { useApp } from './app-state';
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
      <p>Use the repository selector in the toolbar to register a local Git repository.</p>
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
        <div className="main">
          <RefSidebar />
          <div className="center">
            <CommitGraph />
            <WorkPanel />
          </div>
          <CommitDetail />
        </div>
      )}
    </div>
  );
}
