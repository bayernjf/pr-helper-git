import { useCallback, useEffect, useMemo, useState } from 'react';
import { githubProxy } from '../api';
import { useApp } from '../app-state';
import type { PullRequest } from '../types';
import CreatePrModal from './CreatePrModal';
import PrDetailModal from './PrDetailModal';

type Column = 'open' | 'merged' | 'closed';

function CheckSummary({ pr }: { pr: PullRequest }) {
  if (!pr.mergeable && pr.state === 'open') {
    return (
      <span className="pr-checks">
        <span className="check-dot failure" /> conflicts
      </span>
    );
  }
  if (pr.mergeable_state === 'clean') {
    return (
      <span className="pr-checks">
        <span className="check-dot success" /> mergeable
      </span>
    );
  }
  if (pr.mergeable_state === 'unknown' || pr.mergeable_state === null) {
    return (
      <span className="pr-checks">
        <span className="check-dot pending" /> computing
      </span>
    );
  }
  return (
    <span className="pr-checks">
      <span className="check-dot pending" /> {pr.mergeable_state}
    </span>
  );
}

function PrCard({ pr, onOpen }: { pr: PullRequest; onOpen: () => void }) {
  return (
    <div className="pr-card" onClick={onOpen}>
      <div className="pr-card-title">
        {pr.draft && <span className="draft-tag">draft</span>} #{pr.number} {pr.title}
      </div>
      <div className="pr-card-meta">
        <span>{pr.head.ref} → {pr.base.ref}</span>
        <span>· {pr.user.login}</span>
      </div>
      {pr.state === 'open' && <CheckSummary pr={pr} />}
    </div>
  );
}

const COLUMNS: Array<{ key: Column; label: string }> = [
  { key: 'open', label: 'Open' },
  { key: 'merged', label: 'Merged' },
  { key: 'closed', label: 'Closed' },
];

export default function PrBoard() {
  const { pat, remote, refs, activeRepo, refresh } = useApp();
  const [pulls, setPulls] = useState<PullRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [detailNumber, setDetailNumber] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!pat || !remote?.isGithub || !remote.owner || !remote.repo) return;
    setLoading(true);
    setError(null);
    try {
      const res = await githubProxy<PullRequest[]>(
        pat,
        `/repos/${remote.owner}/${remote.repo}/pulls?state=all&per_page=50`,
      );
      setPulls(Array.isArray(res.data) ? res.data : []);
    } catch (err: any) {
      setError(err.detail ? `${err.message}: ${err.detail}` : err.message);
    } finally {
      setLoading(false);
    }
  }, [pat, remote]);

  useEffect(() => {
    load();
  }, [load]);

  const columns = useMemo(() => {
    const bucket: Record<Column, PullRequest[]> = { open: [], merged: [], closed: [] };
    for (const pr of pulls) {
      if (pr.state === 'open') bucket.open.push(pr);
      else if (pr.merged) bucket.merged.push(pr);
      else bucket.closed.push(pr);
    }
    return bucket;
  }, [pulls]);

  if (!remote?.isGithub) {
    return (
      <div className="pr-board-empty">
        <h2>No GitHub remote</h2>
        <p>Pull-request features need an origin remote hosted on github.com for {activeRepo}.</p>
      </div>
    );
  }

  if (!pat) {
    return (
      <div className="pr-board-empty">
        <h2>No GitHub token configured</h2>
        <p>Open settings (⚙) and add a personal access token to manage pull requests.</p>
      </div>
    );
  }

  const detailPr = pulls.find((p) => p.number === detailNumber) || null;

  return (
    <>
      <div className="pr-toolbar">
        <strong>{remote.owner}/{remote.repo}</strong>
        <span className="pr-toolbar-spacer" />
        <button type="button" className="btn" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
          New pull request
        </button>
      </div>
      {error && <div className="pr-error">{error}</div>}
      <div className="pr-board" style={{ paddingTop: 12 }}>
        {COLUMNS.map((col) => (
          <div key={col.key} className="pr-column">
            <div className="pr-column-header">
              <span>{col.label}</span>
              <span>{columns[col.key].length}</span>
            </div>
            <div className="pr-column-body">
              {columns[col.key].map((pr) => (
                <PrCard key={pr.number} pr={pr} onOpen={() => setDetailNumber(pr.number)} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {showCreate && (
        <CreatePrModal
          headRefs={refs}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            load();
            refresh();
          }}
        />
      )}
      {detailPr && (
        <PrDetailModal
          pr={detailPr}
          onClose={() => setDetailNumber(null)}
          onChanged={() => {
            setDetailNumber(null);
            load();
          }}
        />
      )}
    </>
  );
}
