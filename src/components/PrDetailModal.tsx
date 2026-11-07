import { useEffect, useState } from 'react';
import { githubProxy, markReadyForReview, mergePull } from '../api';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import { formatFullDate, formatRelative, shortHash } from '../lib/format';
import type { CheckRun, PullRequest } from '../types';
import {
  IconCheck,
  IconExternal,
  IconFile,
  IconMerge,
  IconRocket,
  IconX,
} from './icons';
import PrFileReview, { type PrFile, type ReviewComment } from './PrFileReview';
import { useConfirm } from './ui';

type MergeMethod = 'merge' | 'squash' | 'rebase';

interface PrCommit {
  sha: string;
  commit: { message: string };
}
interface Reviewer {
  login: string;
  avatar_url: string;
}
interface PrComment {
  id: number;
  user: { login: string; avatar_url: string };
  body: string;
  created_at: string;
  author_association: string;
}
type PullReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
interface PrReview {
  id: number;
  user: { login: string; avatar_url: string };
  state: PullReviewEvent | 'DISMISSED' | 'PENDING';
  body: string;
  submitted_at: string | null;
  author_association: string;
}

const MERGE_INFO: Record<MergeMethod, { name: string; desc: string }> = {
  merge: { name: 'Merge commit', desc: 'Preserve all commits and add a merge commit' },
  squash: { name: 'Squash and merge', desc: 'Combine all commits into one new commit' },
  rebase: { name: 'Rebase and merge', desc: 'Replay commits onto the base without a merge commit' },
};

export default function PrDetailModal({
  pr,
  onClose,
  onChanged,
}: {
  pr: PullRequest;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { pat, remote, activeRepo, toast } = useApp();
  const confirm = useConfirm();
  useEscape(onClose);
  const [checks, setChecks] = useState<CheckRun[]>([]);
  const [prCommits, setPrCommits] = useState<PrCommit[]>([]);
  const [prFiles, setPrFiles] = useState<PrFile[]>([]);
  const [reviewers, setReviewers] = useState<Reviewer[]>([]);
  const [reviewerInput, setReviewerInput] = useState('');
  const [comments, setComments] = useState<PrComment[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [reviews, setReviews] = useState<PrReview[]>([]);
  const [reviewComments, setReviewComments] = useState<ReviewComment[]>([]);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [reviewBody, setReviewBody] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [method, setMethod] = useState<MergeMethod>('squash');
  const [working, setWorking] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editBody, setEditBody] = useState('');
  const [editWorking, setEditWorking] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');

  const base = `/repos/${remote!.owner}/${remote!.repo}`;

  // GitHub caps list endpoints at 30 items by default; large pull requests
  // would silently lose files, commits and comments. Walk pages until a short
  // page arrives (bounded so a misbehaving server cannot loop forever).
  async function fetchPages<T>(path: string): Promise<{ data: T[] }> {
    const all: T[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const res = await githubProxy<T[]>(pat, `${path}?per_page=100&page=${page}`);
      const items = Array.isArray(res.data) ? res.data : [];
      all.push(...items);
      if (items.length < 100) break;
    }
    return { data: all };
  }

  useEffect(() => {
    let cancelled = false;
    // allSettled: a single endpoint failing must not blank the whole modal.
    // In particular requested-reviewers returns 404 when nobody is requested.
    Promise.allSettled([
      githubProxy<{ check_runs: CheckRun[] }>(pat, `${base}/commits/${pr.head.sha}/check-runs`),
      fetchPages<PrCommit>(`${base}/pulls/${pr.number}/commits`),
      fetchPages<PrFile>(`${base}/pulls/${pr.number}/files`),
      githubProxy<{ users: Reviewer[] }>(pat, `${base}/pulls/${pr.number}/requested-reviewers`),
      fetchPages<PrComment>(`${base}/issues/${pr.number}/comments`),
      fetchPages<PrReview>(`${base}/pulls/${pr.number}/reviews`),
      fetchPages<ReviewComment>(`${base}/pulls/${pr.number}/comments`),
    ])
      .then((settled) => {
        if (cancelled) return;
        const dataOf = <T,>(s: PromiseSettledResult<{ data: T }>, fallback: T): T =>
          s.status === 'fulfilled' ? s.value.data : fallback;
        setChecks(dataOf(settled[0], { check_runs: [] }).check_runs || []);
        setPrCommits(dataOf(settled[1], [] as PrCommit[]));
        setPrFiles(dataOf(settled[2], [] as PrFile[]));
        setReviewers(dataOf(settled[3], { users: [] as Reviewer[] }).users || []);
        setComments(dataOf(settled[4], [] as PrComment[]));
        setReviews(dataOf(settled[5], [] as PrReview[]));
        setReviewComments(dataOf(settled[6], [] as ReviewComment[]));
      })
      .catch(() => {
        if (!cancelled) toast('Failed to load PR details', 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [pat, base, pr.number, pr.head.sha, toast]);

  async function merge() {
    const ok = await confirm(
      `Merge PR #${pr.number} using ${method}?`,
      'Branch protection and required reviews are enforced by GitHub.',
    );
    if (!ok) return;
    setWorking(true);
    try {
      await mergePull(activeRepo!, pr.number, method, pat);
      toast('Pull request merged', 'success');
      onChanged();
    } catch (err: any) {
      toast(err.detail ? `${err.message}: ${err.detail}` : err.message, 'error');
    } finally {
      // Reset even on success: the modal stays open and the footer buttons
      // would otherwise remain disabled after the action completed.
      setWorking(false);
    }
  }

  async function markReady() {
    setWorking(true);
    try {
      await markReadyForReview(activeRepo!, pr.number, pat);
      toast('Pull request is now ready for review', 'success');
      onChanged();
    } catch (err: any) {
      toast(err.detail ? `${err.message}: ${err.detail}` : err.message, 'error');
    } finally {
      setWorking(false);
    }
  }

  async function addReviewer() {
    const username = reviewerInput.trim().replace(/^@/, '');
    if (!username || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(username)) {
      toast('Enter a valid GitHub username', 'error');
      return;
    }
    if (reviewers.some((r) => r.login.toLowerCase() === username.toLowerCase())) {
      setReviewerInput('');
      return;
    }
    try {
      await githubProxy(
        pat,
        `${base}/pulls/${pr.number}/requested-reviewers`,
        'POST',
        { reviewers: [username] },
      );
      setReviewers((prev) => [...prev, { login: username, avatar_url: '' }]);
      setReviewerInput('');
      toast('Reviewer requested', 'success');
    } catch (err: any) {
      toast(err.detail ? `${err.message}: ${err.detail}` : err.message, 'error');
    }
  }

  async function postComment() {
    const body = commentBody.trim();
    if (!body || posting) return;
    setPosting(true);
    try {
      const res = await githubProxy<PrComment>(
        pat,
        `${base}/issues/${pr.number}/comments`,
        'POST',
        { body },
      );
      setComments((prev) => [...prev, res.data]);
      setCommentBody('');
      toast('Comment added', 'success');
    } catch (err: any) {
      toast(err.detail ? `${err.message}: ${err.detail}` : err.message, 'error');
    } finally {
      setPosting(false);
    }
  }

  function startEditComment(c: PrComment) {
    setEditingId(c.id);
    setEditBody(c.body);
  }

  function cancelEditComment() {
    setEditingId(null);
    setEditBody('');
  }

  async function submitEditComment(c: PrComment) {
    const body = editBody.trim();
    if (!body) {
      toast('Comment body cannot be empty', 'error');
      return;
    }
    setEditWorking(true);
    try {
      const res = await githubProxy<PrComment>(
        pat,
        `${base}/issues/comments/${c.id}`,
        'PATCH',
        { body },
      );
      setComments((prev) => prev.map((item) => (item.id === c.id ? res.data : item)));
      setEditingId(null);
      setEditBody('');
      toast('Comment updated', 'success');
    } catch (err: any) {
      toast(err.detail ? `${err.message}: ${err.detail}` : err.message, 'error');
    } finally {
      setEditWorking(false);
    }
  }

  async function deleteComment(c: PrComment) {
    const ok = await confirm(
      'Delete this comment?',
      'This permanently removes the comment on GitHub and cannot be undone.',
    );
    if (!ok) return;
    setEditWorking(true);
    try {
      await githubProxy(
        pat,
        `${base}/issues/comments/${c.id}`,
        'DELETE',
      );
      setComments((prev) => prev.filter((item) => item.id !== c.id));
      toast('Comment deleted', 'success');
    } catch (err: any) {
      toast(err.detail ? `${err.message}: ${err.detail}` : err.message, 'error');
    } finally {
      setEditWorking(false);
    }
  }

  function startEditDescription() {
    setDescriptionDraft(pr.body || '');
    setEditingDescription(true);
  }

  async function submitEditDescription() {
    const body = descriptionDraft;
    setEditWorking(true);
    try {
      const res = await githubProxy<PullRequest>(
        pat,
        `${base}/pulls/${pr.number}`,
        'PATCH',
        { body },
      );
      pr.body = res.data.body;
      setEditingDescription(false);
      toast('Description updated', 'success');
      onChanged();
    } catch (err: any) {
      toast(err.detail ? `${err.message}: ${err.detail}` : err.message, 'error');
    } finally {
      setEditWorking(false);
    }
  }

  async function submitReview(event: PullReviewEvent) {
    if (submittingReview) return;
    const body = reviewBody.trim();
    // GitHub requires a summary when requesting changes.
    if (event === 'REQUEST_CHANGES' && !body) {
      toast('A review comment is required to request changes', 'error');
      return;
    }
    setSubmittingReview(true);
    try {
      const res = await githubProxy<PrReview>(
        pat,
        `${base}/pulls/${pr.number}/reviews`,
        'POST',
        { body, event },
      );
      setReviews((prev) => [...prev, res.data]);
      setReviewBody('');
      toast('Review submitted', 'success');
      onChanged();
    } catch (err: any) {
      toast(err.detail ? `${err.message}: ${err.detail}` : err.message, 'error');
    } finally {
      setSubmittingReview(false);
    }
  }

  async function changeState(state: 'open' | 'closed') {
    const ok = await confirm(state === 'closed' ? `Close PR #${pr.number}?` : `Reopen PR #${pr.number}?`);
    if (!ok) return;
    setWorking(true);
    try {
      await githubProxy(pat, `${base}/pulls/${pr.number}`, 'PATCH', { state });
      toast(state === 'closed' ? 'Pull request closed' : 'Pull request reopened', 'success');
      onChanged();
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setWorking(false);
    }
  }

  const totalAdd = prFiles.reduce((s, f) => s + f.additions, 0);
  const totalDel = prFiles.reduce((s, f) => s + f.deletions, 0);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="modal"
        style={{ width: 720, maxHeight: '86vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>#{pr.number} {pr.title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" title="Close" onClick={onClose}><IconX /></button>
        </div>

        <div className="modal-body">
          <div className="detail-value muted" style={{ marginBottom: 16 }}>
            {pr.head.label} → {pr.base.label} · opened by {pr.user.login} on{' '}
            {formatFullDate(pr.created_at)}
          </div>

          <div className="detail-section">
            <span className="detail-label">
              Description
              {pr.state === 'open' && !editingDescription && (
                <button
                  type="button"
                  className="comment-tool-btn"
                  style={{ marginLeft: 8 }}
                  onClick={startEditDescription}
                >
                  Edit
                </button>
              )}
            </span>
            {editingDescription ? (
              <div className="review-inline-composer">
                <textarea
                  value={descriptionDraft}
                  autoFocus
                  rows={4}
                  aria-label="Pull request description"
                  onChange={(e) => setDescriptionDraft(e.target.value)}
                />
                <div className="review-composer-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setEditingDescription(false)}
                    disabled={editWorking}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={submitEditDescription}
                    disabled={editWorking}
                  >
                    {editWorking ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            ) : pr.body ? (
              <div className="pr-description">{pr.body}</div>
            ) : (
              <div className="detail-value muted">No description provided.</div>
            )}
          </div>

          <div className="detail-section">
            <span className="detail-label">
              Commits ({prCommits.length})
            </span>
            <div className="pr-detail-list">
              {prCommits.map((c) => (
                <div key={c.sha} className="pr-detail-item">
                  <span className="hash">{shortHash(c.sha)}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {c.commit.message.split('\n')[0]}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="detail-section">
            <span className="detail-label">
              Files changed ({prFiles.length})
              <span className="changes-stats" style={{ marginLeft: 8, fontWeight: 600 }}>
                <span className="add">+{totalAdd}</span>
                <span className="del">-{totalDel}</span>
              </span>
            </span>
            <div className="pr-detail-list">
              {prFiles.map((f) => (
                <div key={f.filename} className="pr-file-block">
                  <div className="pr-detail-item">
                    <IconFile width={13} height={13} style={{ color: 'var(--faint)' }} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {f.filename}
                    </span>
                    <span className="changes-stats">
                      <span className="add">+{f.additions}</span>
                      <span className="del">-{f.deletions}</span>
                    </span>
                    <button
                      type="button"
                      className="comment-tool-btn"
                      onClick={() => setExpandedFile((cur) => (cur === f.filename ? null : f.filename))}
                    >
                      {expandedFile === f.filename ? 'Hide' : 'Review'}
                    </button>
                  </div>
                  {expandedFile === f.filename && (
                    <PrFileReview
                      file={f}
                      comments={reviewComments.filter((c) => c.path === f.filename)}
                      headSha={pr.head.sha}
                      base={`${base}/pulls/${pr.number}`}
                      canComment={pr.state === 'open'}
                      onPosted={(c) => setReviewComments((prev) => [...prev, c])}
                      onChanged={(c) => setReviewComments((prev) =>
                        prev.map((item) => (item.id === c.id ? c : item)))}
                      onDeleted={(id) => setReviewComments((prev) =>
                        prev.filter((item) => item.id !== id))}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="detail-section">
            <span className="detail-label">Reviewers ({reviewers.length})</span>
            {reviewers.length === 0 ? (
              <div className="detail-value muted">No reviewers requested yet.</div>
            ) : (
              <div className="reviewer-list">
                {reviewers.map((r) => (
                  <span key={r.login} className="reviewer-chip">
                    {r.avatar_url
                      ? <img src={r.avatar_url} alt="" width={18} height={18} />
                      : <span className="reviewer-avatar">{r.login.slice(0, 1).toUpperCase()}</span>}
                    {r.login}
                  </span>
                ))}
              </div>
            )}
            {pr.state === 'open' && (
              <div className="reviewer-add">
                <input
                  value={reviewerInput}
                  placeholder="GitHub username…"
                  aria-label="GitHub username"
                  onChange={(e) => setReviewerInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addReviewer();
                    }
                  }}
                />
                <button type="button" className="btn" onClick={addReviewer}>Request</button>
              </div>
            )}
          </div>

          <div className="detail-section">
            <span className="detail-label">Reviews ({reviews.length})</span>
            {reviews.length === 0 ? (
              <div className="detail-value muted">No reviews submitted yet.</div>
            ) : (
              <div className="review-list">
                {reviews.map((rv) => (
                  <div key={rv.id} className="pr-review-item">
                    {rv.user.avatar_url
                      ? <img src={rv.user.avatar_url} alt="" width={20} height={20} />
                      : <span className="detail-avatar">{rv.user.login.slice(0, 1).toUpperCase()}</span>}
                    <div className="pr-review-body">
                      <div className="comment-head">
                        <span className="comment-user">{rv.user.login}</span>
                        <span className={`review-state review-state-${rv.state.toLowerCase()}`}>
                          {rv.state.replace(/_/g, ' ').toLowerCase()}
                        </span>
                      </div>
                      {rv.body && <div className="comment-text">{rv.body}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {pr.state === 'open' && (
              <div className="review-compose">
                <textarea
                  value={reviewBody}
                  placeholder="Review summary…"
                  rows={2}
                  aria-label="Review summary"
                  onChange={(e) => setReviewBody(e.target.value)}
                />
                <div className="review-compose-actions">
                  <button
                    type="button"
                    className="btn"
                    disabled={submittingReview || !reviewBody.trim()}
                    onClick={() => submitReview('COMMENT')}
                  >
                    Comment
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={submittingReview}
                    onClick={() => submitReview('APPROVE')}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={submittingReview}
                    onClick={() => submitReview('REQUEST_CHANGES')}
                  >
                    Request changes
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="detail-section">
            <span className="detail-label">Checks</span>
            {checks.length === 0 ? (
              <div className="detail-value muted">No check runs reported.</div>
            ) : (
              <div className="pr-detail-list">
                {checks.map((c) => (
                  <div key={c.id} className="pr-detail-item">
                    <span style={{
                      color: c.conclusion === 'success' ? 'var(--green)'
                        : c.conclusion === null ? 'var(--yellow)' : 'var(--red)',
                    }}>
                      {c.conclusion === null ? <IconClock /> : c.conclusion === 'success' ? <IconCheck width={14} height={14} /> : <IconX width={14} height={14} />}
                    </span>
                    <span style={{ flex: 1 }}>{c.name}</span>
                    <span className="detail-value muted">{c.conclusion || c.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="detail-section">
            <span className="detail-label">Comments ({comments.length})</span>
            {comments.length === 0 ? (
              <div className="detail-value muted">No comments yet.</div>
            ) : (
              <div className="comment-list">
                {comments.map((c) => (
                  <div key={c.id} className="comment-item">
                    {c.user.avatar_url
                      ? <img className="comment-avatar" src={c.user.avatar_url} alt="" width={24} height={24} />
                      : <span className="detail-avatar">{c.user.login.slice(0, 1).toUpperCase()}</span>}
                    <div className="comment-body">
                      <div className="comment-head">
                        <span className="comment-user">{c.user.login}</span>
                        <span className="detail-value muted">{formatRelative(c.created_at)}</span>
                        {editingId !== c.id && (
                          <span className="comment-tools">
                            <button
                              type="button"
                              className="comment-tool-btn"
                              title="Edit comment"
                              onClick={() => startEditComment(c)}
                              disabled={editWorking}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="comment-tool-btn danger"
                              title="Delete comment"
                              onClick={() => deleteComment(c)}
                              disabled={editWorking}
                            >
                              Delete
                            </button>
                          </span>
                        )}
                      </div>
                      {editingId === c.id ? (
                        <div className="comment-edit">
                          <textarea
                            value={editBody}
                            autoFocus
                            onChange={(e) => setEditBody(e.target.value)}
                            aria-label="Edit comment body"
                          />
                          <div className="comment-edit-actions">
                            <button
                              type="button"
                              className="btn"
                              onClick={cancelEditComment}
                              disabled={editWorking}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="btn btn-primary"
                              onClick={() => submitEditComment(c)}
                              disabled={editWorking}
                            >
                              {editWorking ? 'Saving…' : 'Save'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="comment-text">{c.body}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="comment-compose">
              <textarea
                value={commentBody}
                placeholder="Write a comment…"
                rows={2}
                aria-label="Comment body"
                onChange={(e) => setCommentBody(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    postComment();
                  }
                }}
              />
              <div className="comment-compose-side">
                <span className="hint">Cmd/Ctrl+Enter to post</span>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={posting || !commentBody.trim()}
                  onClick={postComment}
                >
                  {posting ? 'Posting…' : 'Comment'}
                </button>
              </div>
            </div>
          </div>

          {pr.state === 'open' && (
            <div className="detail-section">
              <span className="detail-label">Merge method</span>
              <div className="merge-options">
                {(Object.keys(MERGE_INFO) as MergeMethod[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`merge-option${method === m ? ' active' : ''}`}
                    onClick={() => setMethod(m)}
                  >
                    {m === 'merge' ? <IconMerge width={17} height={17} />
                      : m === 'squash' ? <IconRocket width={17} height={17} />
                      : <IconCheck width={17} height={17} />}
                    <span>
                      <span className="merge-name">{MERGE_INFO[m].name}</span>
                      <span className="merge-desc" style={{ display: 'block' }}>
                        {MERGE_INFO[m].desc}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <a className="btn" href={pr.html_url} target="_blank" rel="noreferrer">
            <IconExternal width={14} height={14} />
            Open on GitHub
          </a>
          {pr.state === 'open' ? (
            <>
              <button type="button" className="btn" disabled={working} onClick={() => changeState('closed')}>
                Close
              </button>
              {pr.draft ? (
                <button type="button" className="btn btn-primary" disabled={working} onClick={markReady}>
                  Ready for review
                </button>
              ) : (
                <button type="button" className="btn btn-primary" disabled={working} onClick={merge}>
                  Merge
                </button>
              )}
            </>
          ) : (
            !pr.merged && !pr.merged_at && (
              <button type="button" className="btn btn-primary" disabled={working} onClick={() => changeState('open')}>
                Reopen
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function IconClock() {
  return <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />;
}
