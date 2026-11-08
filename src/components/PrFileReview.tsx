import { useMemo, useState } from 'react';
import { githubProxy } from '../api';
import { useApp } from '../app-state';
import { formatRelative } from '../lib/format';
import { parseDiffLines, type ParsedDiffLine } from '../lib/diff-lines';
import { useConfirm } from './ui';
import { t } from '../i18n';

// A hunk is whitespace-only when every removed line has an added counterpart
// whose text is identical once all whitespace is stripped.
function whitespaceOnlyHunk(body: ParsedDiffLine[]): boolean {
  const dels = body.filter((r) => r.kind === 'del').map((r) => r.text);
  const adds = body.filter((r) => r.kind === 'add').map((r) => r.text);
  if (!dels.length || !adds.length || dels.length !== adds.length) return false;
  return dels.every((text, i) => text.replace(/\s+/g, '') === adds[i].replace(/\s+/g, ''));
}

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
  onChanged,
  onDeleted,
}: {
  file: PrFile;
  comments: ReviewComment[];
  headSha: string;
  base: string;
  canComment: boolean;
  onPosted: (comment: ReviewComment) => void;
  onChanged: (comment: ReviewComment) => void;
  onDeleted: (id: number) => void;
}) {
  const { pat, toast } = useApp();
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [hideWs, setHideWs] = useState(false);

  const rows = useMemo(
    () => (file.patch ? parseDiffLines(file.patch) : []),
    [file.patch],
  );

  // Locate hunks whose body only changes whitespace, plus the end index of
  // each such hunk, so the renderer can collapse them behind one placeholder.
  const whitespaceHunks = useMemo(() => {
    const map = new Map<number, number>();
    for (let i = 0; i < rows.length; i += 1) {
      if (rows[i].kind !== 'hunk') continue;
      let end = i + 1;
      while (end < rows.length && rows[end].kind !== 'hunk' && rows[end].kind !== 'meta') end += 1;
      if (end > i + 1 && whitespaceOnlyHunk(rows.slice(i + 1, end))) map.set(i, end);
      i = end - 1;
    }
    return map;
  }, [rows]);

  const display = useMemo(() => {
    if (!hideWs) {
      return rows.map((row, index) => ({ kind: 'row' as const, row, index }));
    }
    const entries: Array<
      | { kind: 'row'; row: ParsedDiffLine; index: number }
      | { kind: 'hidden'; start: number; end: number }
    > = [];
    for (let i = 0; i < rows.length; i += 1) {
      const end = whitespaceHunks.get(i);
      if (end) {
        entries.push({ kind: 'hidden', start: i, end });
        i = end - 1;
      } else {
        entries.push({ kind: 'row', row: rows[i], index: i });
      }
    }
    return entries;
  }, [rows, hideWs, whitespaceHunks]);

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
      toast(t("Comment body cannot be empty"), 'error');
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
      toast(t("Review comment added"), 'success');
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
        <div className="detail-value muted">{t("No text diff available for this file.")}</div>
      ) : (
        <>
          <div className="review-file-toolbar">
            <span className="hint">
              {whitespaceHunks.size > 0
                ? `${whitespaceHunks.size} whitespace-only hunk${whitespaceHunks.size === 1 ? '' : 's'}`
                : 'No whitespace-only hunks'}
            </span>
            <button
              type="button"
              className={`btn${hideWs ? ' btn-primary' : ''}`}
              disabled={whitespaceHunks.size === 0}
              title={t("Collapse hunks whose changes are only whitespace")}
              onClick={() => setHideWs((v) => !v)}
            >
              {hideWs ? 'Show whitespace changes' : 'Hide whitespace changes'}
            </button>
          </div>
          <pre className="review-diff">
          {display.map((entry) => {
            if (entry.kind === 'hidden') {
              const hiddenRows = rows.slice(entry.start + 1, entry.end);
              const hiddenComments = hiddenRows.flatMap((row) => commentsForRow(row));
              return (
                <div key={`hidden-${entry.start}`}>
                  <div className="review-ws-hidden">
                    Whitespace-only changes hidden ({hiddenRows.length} lines)
                  </div>
                  {hiddenComments.length > 0 && (
                    <div className="review-comment-group">
                      {hiddenComments.map((c) => (
                        <ReviewCommentCard
                          key={c.id}
                          comment={c}
                          base={base}
                          canComment={canComment}
                          onPosted={onPosted}
                          onChanged={onChanged}
                          onDeleted={onDeleted}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            }
            const row = entry.row;
            const i = entry.index;
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
                        title={t("Add a comment on this line")}
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
                      <ReviewCommentCard
                        key={c.id}
                        comment={c}
                        base={base}
                        canComment={canComment}
                        onPosted={onPosted}
                        onChanged={onChanged}
                        onDeleted={onDeleted}
                      />
                    ))}
                  </div>
                )}

                {anchor && rowAnchor && anchor.line === rowAnchor.line && anchor.side === rowAnchor.side && (
                  <div className="review-inline-composer">
                    <textarea
                      value={draft}
                      autoFocus
                      rows={2}
                      aria-label={t("Review comment")}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                          e.preventDefault();
                          void submit();
                        }
                      }}
                    />
                    <div className="review-composer-actions">
                      <span className="hint">{t("Cmd/Ctrl+Enter to submit")}</span>
                      <button type="button" className="btn" onClick={resetComposer} disabled={posting}>
                        {t("Cancel")}</button>
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
        </>
      )}

      {outdated.length > 0 && (
        <div className="review-outdated">
          <div className="detail-label">{t("Outdated comments")}</div>
          {outdated.map((c) => (
            <ReviewCommentCard
              key={c.id}
              comment={c}
              base={base}
              canComment={canComment}
              onPosted={onPosted}
              onChanged={onChanged}
              onDeleted={onDeleted}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewCommentCard({
  comment,
  base,
  canComment,
  onPosted,
  onChanged,
  onDeleted,
}: {
  comment: ReviewComment;
  base: string;
  canComment: boolean;
  onPosted: (comment: ReviewComment) => void;
  onChanged: (comment: ReviewComment) => void;
  onDeleted: (id: number) => void;
}) {
  const { pat, toast } = useApp();
  const confirm = useConfirm();
  const [mode, setMode] = useState<'view' | 'reply' | 'edit'>('view');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  // Single-comment review endpoints sit at the flat pulls/comments/:cid path,
  // derived from the per-PR base (/repos/:o/:r/pulls/:n -> /repos/:o/:r).
  const repoBase = base.replace(/\/pulls\/\d+$/, '');
  const singleCommentPath = `${repoBase}/pulls/comments/${comment.id}`;

  function openReply() {
    setMode('reply');
    setDraft('');
  }

  function openEdit() {
    setMode('edit');
    setDraft(comment.body);
  }

  function cancel() {
    setMode('view');
    setDraft('');
  }

  async function submit() {
    const body = draft.trim();
    if (!body) {
      toast(t("Comment body cannot be empty"), 'error');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'reply') {
        // A reply only needs in_reply_to; line/side are inherited upstream.
        const res = await githubProxy<ReviewComment>(
          pat,
          `${base}/comments`,
          'POST',
          { body, in_reply_to: comment.id },
        );
        onPosted(res.data);
        toast(t("Reply added"), 'success');
      } else {
        const res = await githubProxy<ReviewComment>(
          pat,
          singleCommentPath,
          'PATCH',
          { body },
        );
        onChanged(res.data);
        toast(t("Review comment updated"), 'success');
      }
      setMode('view');
      setDraft('');
    } catch (err: any) {
      toast(err.detail ? `${err.message}: ${err.detail}` : err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const ok = await confirm(
      'Delete this comment?',
      'This permanently removes the comment on GitHub and cannot be undone.',
    );
    if (!ok) return;
    setBusy(true);
    try {
      await githubProxy(pat, singleCommentPath, 'DELETE');
      onDeleted(comment.id);
      toast(t("Review comment deleted"), 'success');
    } catch (err: any) {
      toast(err.detail ? `${err.message}: ${err.detail}` : err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`review-comment-card${comment.in_reply_to_id ? ' review-comment-reply' : ''}`}>
      {comment.user.avatar_url
        ? <img src={comment.user.avatar_url} alt="" width={20} height={20} />
        : <span className="detail-avatar">{comment.user.login.slice(0, 1).toUpperCase()}</span>}
      <div className="review-comment-body">
        <div className="comment-head">
          <span className="comment-user">{comment.user.login}</span>
          <span className="detail-value muted">{formatRelative(comment.created_at)}</span>
        </div>
        {mode === 'edit' ? (
          <div className="review-inline-composer">
            <textarea
              value={draft}
              autoFocus
              rows={2}
              aria-label={t("Edit review comment")}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
            <div className="review-composer-actions">
              <span className="hint">{t("Cmd/Ctrl+Enter to save")}</span>
              <button type="button" className="btn" onClick={cancel} disabled={busy}>{t("Cancel")}</button>
              <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          <div className="comment-text">{comment.body}</div>
        )}

        {mode === 'view' && canComment && (
          <div className="review-card-actions">
            <button type="button" className="comment-tool-btn" onClick={openReply} disabled={busy}>{t("Reply")}</button>
            <button type="button" className="comment-tool-btn" onClick={openEdit} disabled={busy}>{t("Edit")}</button>
            <button type="button" className="comment-tool-btn danger" onClick={remove} disabled={busy}>{t("Delete")}</button>
          </div>
        )}

        {mode === 'reply' && (
          <div className="review-inline-composer">
            <textarea
              value={draft}
              autoFocus
              rows={2}
              aria-label={t("Reply to review comment")}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
            <div className="review-composer-actions">
              <span className="hint">{t("Cmd/Ctrl+Enter to reply")}</span>
              <button type="button" className="btn" onClick={cancel} disabled={busy}>{t("Cancel")}</button>
              <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
                {busy ? 'Posting…' : 'Reply'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
