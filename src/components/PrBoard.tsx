import { useCallback, useEffect, useMemo, useState } from 'react';
import { githubProxy } from '../api';
import { useApp } from '../app-state';
import type { PullRequest, ReviewState } from '../types';
import { summarizeReviews, type GithubReview } from '../lib/review';
import {
  IconCheck,
  IconInbox,
  IconPlus,
  IconPullRequest,
  IconRefresh,
  IconX,
} from './icons';
import CreatePrModal from './CreatePrModal';
import PrDetailModal from './PrDetailModal';

type Column = 'open' | 'merged' | 'closed';

function MergePill({ pr }: { pr: PullRequest }) {
  if (pr.mergeable === false) {
    return <span className="merge-pill blocked"><IconX width={12} height={12} /> conflicts</span>;
  }
  if (pr.mergeable_state === 'clean') {
    return <span className="merge-pill ok"><IconCheck width={12} height={12} /> mergeable</span>;
  }
  return <span className="merge-pill unknown">computing</span>;
}

function ReviewPill({ state }: { state: ReviewState }) {
  if (state === 'APPROVED') return <span className="review-pill approved">Approved</span>;
  if (state === 'CHANGES_REQUESTED') return <span className="review-pill changes">Changes requested</span>;
  if (state === 'COMMENTED') return <span className="review-pill commented">Review comments</span>;
  return <span className="review-pill none">No review</span>;
}

function PrCard({ pr, onOpen }: { pr: PullRequest; onOpen: () => void }) {
  return (
    <button type="button" className="pr-card" onClick={onOpen}>
      <div className="pr-title">
        {pr.draft && <span className="draft-tag">draft</span>}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>#{pr.number} {pr.title}</span>
      </div>
      <div className="pr-meta">
        <span className="pr-refs">{pr.head.ref} → {pr.base.ref}</span>
      </div>
      <div className="pr-meta" style={{ marginTop: 8, gap: 6 }}>
        {pr.state === 'open' && <MergePill pr={pr} />}
        <ReviewPill state={pr.reviewState} />
      </div>
      <div className="pr-meta" style={{ marginTop: 8 }}>
        <span className="mini-avatar">{pr.user.login.slice(0, 1).toUpperCase()}</span>
        {pr.user.login}
      </div>
    </button>
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
      const list = Array.isArray(res.data) ? res.data : [];
      // Attach the review summary for every open PR.
      const enriched = await Promise.all(
        list.map(async (pr) => {
          if (pr.state !== 'open') return { ...pr, reviewState: 'NONE' as ReviewState };
          try {
            const reviews = await githubProxy<GithubReview[]>(
              pat,
              `/repos/${remote.owner}/${remote.repo}/pulls/${pr.number}/reviews`,
            );
            return { ...pr, reviewState: summarizeReviews(reviews.data || []) };
          } catch {
            return { ...pr, reviewState: 'NONE' as ReviewState };
          }
        }),
      );
      setPulls(enriched);
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
      // The list endpoint omits the `merged` boolean; merged_at is the
      // reliable signal that a closed PR was merged rather than abandoned.
      if (pr.state === 'open') bucket.open.push(pr);
      else if (pr.merged || pr.merged_at) bucket.merged.push(pr);
      else bucket.closed.push(pr);
    }
    return bucket;
  }, [pulls]);

  if (!remote?.isGithub) {
    return (
      <div className="empty-state">
        <div className="empty-icon"><IconInbox width={28} height={28} /></div>
        <h3>No GitHub remote</h3>
        <p>Pull-request features need an origin remote hosted on github.com for {activeRepo}.</p>
      </div>
    );
  }

  if (!pat) {
    return (
      <div className="empty-state">
        <div className="empty-icon"><IconPullRequest width={28} height={28} /></div>
        <h3>No GitHub token configured</h3>
        <p>Open settings and add a personal access token to manage pull requests.</p>
      </div>
    );
  }

  const detailPr = pulls.find((p) => p.number === detailNumber) || null;

  return (
    <>
      <div className="toolbar" style={{ height: 44, borderBottom: '1px solid var(--border)' }}>
        <strong style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
          {remote.owner}/{remote.repo}
        </strong>
        <span className="spacer" />
        <button type="button" className="btn" onClick={load} disabled={loading}>
          <IconRefresh width={14} height={14} />
          {loading ? 'Loading' : 'Refresh'}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
          <IconPlus width={14} height={14} />
          New pull request
        </button>
      </div>
      {error && <div className="toast error" style={{ position: 'static', margin: 10 }}>{error}</div>}
      <div className="pr-board">
        {COLUMNS.map((col) => (
          <div key={col.key} className="pr-column">
            <div className="pr-column-head">
              {col.label}
              <span className="pr-count">{columns[col.key].length}</span>
            </div>
            <div className="pr-column-body">
              {columns[col.key].map((pr) => (
                <PrCard key={pr.number} pr={pr} onOpen={() => setDetailNumber(pr.number)} />
              ))}
              {columns[col.key].length === 0 && (
                <div className="diff-empty" style={{ height: 80 }}>Nothing here</div>
              )}
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
