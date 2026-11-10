import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  IconSearch,
  IconX,
} from './icons';
import CreatePrModal from './CreatePrModal';
import PrDetailModal from './PrDetailModal';
import { t, tp } from '../i18n';

type Column = 'open' | 'merged' | 'closed';

// GitHub's maximum page size for the pulls listing.
const PAGE_SIZE = 100;

function MergePill({ pr }: { pr: PullRequest }) {
  if (pr.mergeable === false) {
    return <span className="merge-pill blocked"><IconX width={12} height={12} /> {t("conflicts")}</span>;
  }
  if (pr.mergeable_state === 'clean') {
    return <span className="merge-pill ok"><IconCheck width={12} height={12} /> {t("mergeable")}</span>;
  }
  return <span className="merge-pill unknown">{t("computing")}</span>;
}

function ReviewPill({ state }: { state: ReviewState }) {
  if (state === 'APPROVED') return <span className="review-pill approved">{t("Approved")}</span>;
  if (state === 'CHANGES_REQUESTED') return <span className="review-pill changes">{t("Changes requested")}</span>;
  if (state === 'COMMENTED') return <span className="review-pill commented">{t("Review comments")}</span>;
  return <span className="review-pill none">{t("No review")}</span>;
}

function PrCard({ pr, onOpen }: { pr: PullRequest; onOpen: () => void }) {
  return (
    <button type="button" className="pr-card" onClick={onOpen}>
      <div className="pr-title">
        {pr.draft && <span className="draft-tag">{t("draft")}</span>}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>#{pr.number} {pr.title}</span>
      </div>
      <div className="pr-meta">
        <span className="pr-refs">{pr.head.ref} → {pr.base.ref}</span>
      </div>
      {pr.labels.length > 0 && (
        <div className="pr-label-row">
          {pr.labels.map((label) => {
            const hex = (label.color || '6a6a78').replace('#', '');
            return (
              <span
                key={label.name}
                className="pr-label"
                style={{
                  color: `#${hex}`,
                  background: `#${hex}22`,
                  borderColor: `#${hex}55`,
                }}
              >
                {label.name}
              </span>
            );
          })}
        </div>
      )}
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
  const { pat, hasServerPat, remote, refs, activeRepo, refresh } = useApp();
  const [pulls, setPulls] = useState<PullRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [detailNumber, setDetailNumber] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  // Guards against a slow page landing after the repo/token changed or after a
  // newer refresh started.
  const loadSeq = useRef(0);

  // Fetch one page of PRs and attach the review summary for each open PR.
  const fetchPage = useCallback(async (pageNo: number): Promise<PullRequest[]> => {
    if ((!pat && !hasServerPat) || !remote?.isGithub || !remote.owner || !remote.repo) return [];
    const res = await githubProxy<PullRequest[]>(
      pat,
      `/repos/${remote.owner}/${remote.repo}/pulls?state=all&per_page=${PAGE_SIZE}&page=${pageNo}`,
    );
    const list = Array.isArray(res.data) ? res.data : [];
    return Promise.all(
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
  }, [pat, remote]);

  const load = useCallback(async () => {
    if ((!pat && !hasServerPat) || !remote?.isGithub || !remote.owner || !remote.repo) {
      setPulls([]);
      setHasMore(false);
      setPage(1);
      return;
    }
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    try {
      const list = await fetchPage(1);
      if (seq !== loadSeq.current) return;
      setPulls(list);
      setPage(1);
      setHasMore(list.length >= PAGE_SIZE);
    } catch (err: any) {
      if (seq !== loadSeq.current) return;
      setError(err.detail ? `${err.message}: ${err.detail}` : err.message);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [pat, remote, fetchPage]);

  // Append the next page; GitHub numbers PRs so a number-based merge keeps the
  // list stable even if a PR is edited between requests.
  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    const seq = ++loadSeq.current;
    const nextPage = page + 1;
    setLoading(true);
    setError(null);
    try {
      const list = await fetchPage(nextPage);
      if (seq !== loadSeq.current) return;
      setPulls((prev) => {
        const seen = new Set(prev.map((p) => p.number));
        return [...prev, ...list.filter((p) => !seen.has(p.number))];
      });
      setPage(nextPage);
      setHasMore(list.length >= PAGE_SIZE);
    } catch (err: any) {
      if (seq !== loadSeq.current) return;
      setError(err.detail ? `${err.message}: ${err.detail}` : err.message);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [loading, hasMore, page, fetchPage]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredPulls = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pulls;
    return pulls.filter((pr) => {
      const haystacks = [
        String(pr.number),
        pr.title,
        pr.user.login,
        pr.head.ref,
        pr.base.ref,
        ...pr.labels.map((l) => l.name),
        pr.draft ? 'draft' : '',
      ];
      return haystacks.some((v) => v.toLowerCase().includes(q));
    });
  }, [pulls, query]);

  const columns = useMemo(() => {
    const bucket: Record<Column, PullRequest[]> = { open: [], merged: [], closed: [] };
    for (const pr of filteredPulls) {
      // The list endpoint omits the `merged` boolean; merged_at is the
      // reliable signal that a closed PR was merged rather than abandoned.
      if (pr.state === 'open') bucket.open.push(pr);
      else if (pr.merged || pr.merged_at) bucket.merged.push(pr);
      else bucket.closed.push(pr);
    }
    return bucket;
  }, [filteredPulls]);

  if (!remote?.isGithub) {
    return (
      <div className="empty-state">
        <div className="empty-icon"><IconInbox width={28} height={28} /></div>
        <h3>{t("No GitHub remote")}</h3>
        <p>{tp("Pull-request features need an origin remote hosted on github.com for {repo}.", { repo: activeRepo ?? '' })}</p>
      </div>
    );
  }

  if (!pat && !hasServerPat) {
    return (
      <div className="empty-state">
        <div className="empty-icon"><IconPullRequest width={28} height={28} /></div>
        <h3>{t("No GitHub token configured")}</h3>
        <p>{t("Open settings and add a personal access token to manage pull requests.")}</p>
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
        <div className="board-filter">
          <IconSearch width={14} height={14} />
          <input
            type="text"
            value={query}
            placeholder={t("Filter by number, title, author, branch…")}
            aria-label={t("Filter pull requests")}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              type="button"
              className="icon-btn"
              aria-label={t("Clear filter")}
              title={t("Clear filter")}
              onClick={() => setQuery('')}
            >
              <IconX width={12} height={12} />
            </button>
          )}
        </div>
        <span className="spacer" />
        <button type="button" className="btn" onClick={load} disabled={loading}>
          <IconRefresh width={14} height={14} />
          {loading ? t('Loading') : t('Refresh')}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
          <IconPlus width={14} height={14} />
          {t("New pull request")}</button>
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
                <div className="diff-empty" style={{ height: 80 }}>
                  {query.trim() ? 'No matches' : 'Nothing here'}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      {hasMore && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 14px' }}>
          <button type="button" className="btn" onClick={loadMore} disabled={loading}>
            <IconRefresh width={14} height={14} />
            {loading ? 'Loading' : 'Load more pull requests'}
          </button>
        </div>
      )}

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
