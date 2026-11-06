import { useMemo, useState } from 'react';
import { githubProxy } from '../api';
import { useApp } from '../app-state';
import { formatRelative } from '../lib/format';
import { parseDiffLines } from '../lib/diff-lines';

export interface ReviewComment {
  id: number;
  user: { login: string; avatar_url: string };
  body: string;
  path: string;
  line: number | null;
  original_line: number | null;
  side: 'LEFT' | 'RIGHT';
  commit_id: string;
  in_reply_to_id: number | null;
  created_at: string;
  author_association: string;
}

export interface PrFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

interface Anchor {
  line: number;
  side: 'LEFT' | 'RIGHT';
}

// Per-file unified diff with line-level review comments. Comment anchors use
// the modern line/side parameters (the deprecated `position` is not used).
export default function PrFileReview({
  file,
  comments,
  headSha,
  base,
  canComment,
  onPosted,
}: {
  file: PrFile;
  comments: ReviewComment[];
  headSha: string;
  base: string;
  canComment: boolean;
  onPosted: (comment: ReviewComment) => void;
}) {
  const { pat, toast } = useApp();
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);

  const rows = useMemo(
    () => (file.patch ? parseDiffLines(file.patch) : []),
    [file.patch],
  );

  // Set of (side,line) anchors present in the rendered diff, used to detect
  // comments that no longer attach to any visible row (outdated comments).
  const visibleAnchors = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) {
      if (row.newNo !== null) set.add(`RIGHT:${row.newNo}`);
      if (row.oldNo !== null) set.add(`LEFT:${row.oldNo}`);
    }
    return set;
  }, [rows]);

  function commentsForRow(row: ReturnType<typeof parseDiffLines>[number]): ReviewComment[] {
    return comments.filter((c) => {
      if (c.side === 'RIGHT') return c.line !== null && c.line === row.newNo;
      return c.line !== null && c.line === row.oldNo;
    });
  }

  const outdated = comments.filter(
    (c) => c.line === null || !visibleAnchors.has(`${c.side}:${c.line}`),
  );

  function resetComposer() {
    setAnchor(null);
    setDraft('');
  }

  async function submit() {
    if (!anchor) return;
    const body = draft.trim();
    if (!body) {
      toast('Comment body cannot be empty', 'error');
      return;
    }
    setPosting(true);
    try {
      const res = await githubProxy<ReviewComment>(
        pat,
        `${base}/comments`,
        'POST',
        { body, commit_id: headSha, path: file.filename, line: anchor.line, side: anchor.side },
      );
      onPosted(res.data);
      resetComposer();
      toast('Review comment added', 'success');
    } catch (err: any) {
      toast(err.detail ? `${err.message}: ${err.detail}` : err.message, 'error');
    } finally {
      setPosting(false);
    }
  }

  function signFor(kind: string) {
    return kind === 'add' ? '+' : kind === 'del' ? '-' : ' ';
  }

  return (
    <div className="review-file">
      {!file.patch ? (
        <div className="detail-value muted">No text diff available for this file.</div>
      ) : (
        <pre className="review-diff">
          {rows.map((row, i) => {
            const rowComments = commentsForRow(row);
            // Hunk headers are not commentable; render them as plain rows.
            const rowAnchor: Anchor | null =
              row.kind === 'hunk' || row.kind === 'meta'
                ? null
                : row.kind === 'del'
                  ? { line: row.oldNo as number, side: 'LEFT' }
                  : { line: row.newNo as number, side: 'RIGHT' };
            return (
              <div key={i}>
                <div className={`review-diff-line ${row.kind}`}>
                  <span className="review-add-gutter">
                    {canComment && rowAnchor && (
                      <button
                        type="button"
                        className="review-add-btn"
                        title="Add a comment on this line"
                        onClick={() => {
                          setAnchor(rowAnchor);
                          setDraft('');
                        }}
                      >
                        +
                      </button>
                    )}
                  </span>
                  <span className="review-no">{row.oldNo ?? ''}</span>
                  <span className="review-no">{row.newNo ?? ''}</span>
                  <span className="review-sign">{signFor(row.kind)}</span>
                  <span className="review-code">{row.text || ' '}</span>
                </div>

                {rowComments.length > 0 && (
                  <div className="review-comment-group">
                    {rowComments.map((c) => (
                      <ReviewCommentCard key={c.id} comment={c} />
                    ))}
                  </div>
                )}

                {anchor && rowAnchor && anchor.line === rowAnchor.line && anchor.side === rowAnchor.side && (
                  <div className="review-inline-composer">
                    <textarea
                      value={draft}
                      autoFocus
                      rows={2}
                      aria-label="Review comment"
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                          e.preventDefault();
                          void submit();
                        }
                      }}
                    />
                    <div className="review-composer-actions">
                      <span className="hint">Cmd/Ctrl+Enter to submit</span>
                      <button type="button" className="btn" onClick={resetComposer} disabled={posting}>
                        Cancel
                      </button>
                      <button type="button" className="btn btn-primary" onClick={submit} disabled={posting}>
                        {posting ? 'Posting…' : 'Comment'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </pre>
      )}

      {outdated.length > 0 && (
        <div className="review-outdated">
          <div className="detail-label">Outdated comments</div>
          {outdated.map((c) => <ReviewCommentCard key={c.id} comment={c} />)}
        </div>
      )}
    </div>
  );
}

function ReviewCommentCard({ comment }: { comment: ReviewComment }) {
  return (
    <div className="review-comment-card">
      {comment.user.avatar_url
        ? <img src={comment.user.avatar_url} alt="" width={20} height={20} />
        : <span className="detail-avatar">{comment.user.login.slice(0, 1).toUpperCase()}</span>}
      <div className="review-comment-body">
        <div className="comment-head">
          <span className="comment-user">{comment.user.login}</span>
          <span className="detail-value muted">{formatRelative(comment.created_at)}</span>
        </div>
        <div className="comment-text">{comment.body}</div>
      </div>
    </div>
  );
}
