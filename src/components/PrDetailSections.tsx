import type { CheckRun, PullRequest } from '../types';
import { Dropdown } from './Dropdown';
import { IconCheck, IconMerge, IconRocket, IconX } from './icons';
import { formatRelative, shortHash } from '../lib/format';
import { t, tp } from '../i18n';

export interface PrLabel {
  name: string;
  color?: string;
}
export interface PrCommit {
  sha: string;
  commit: { message: string };
}
export interface Reviewer {
  login: string;
  avatar_url: string;
}

export function LabelsSection({
  state,
  labels,
  repoLabels,
  busy,
  onAdd,
  onRemove,
}: {
  state: string;
  labels: PrLabel[];
  repoLabels: PrLabel[];
  busy: boolean;
  onAdd: (name: string) => void;
  onRemove: (name: string) => void;
}) {
  return (
    <div className="detail-section">
      <span className="detail-label">{t('Labels')}</span>
      <div className="pr-labels">
        {labels.map((label) => (
          <span className="pr-label" key={label.name}>
            <span className="pr-label-dot" style={{ background: `#${label.color || '888888'}` }} />
            {label.name}
            <button
              type="button"
              className="pr-label-remove"
              aria-label={tp('Remove label {name}', { name: label.name })}
              disabled={busy}
              onClick={() => onRemove(label.name)}
            >
              <IconX width={10} height={10} />
            </button>
          </span>
        ))}
        {state === 'open' && (
          <Dropdown
            className="pr-label-add"
            aria-label={t('Add label')}
            disabled={busy}
            value=""
            onChange={(picked) => {
              if (picked) onAdd(picked);
            }}
            options={[
              { value: '', label: `+ ${t('Add label')}` },
              ...repoLabels
                .filter((label) => !labels.some((current) => current.name === label.name))
                .map((label) => ({ value: label.name, label: label.name })),
            ]}
          />
        )}
      </div>
    </div>
  );
}

export function CommitsSection({ commits }: { commits: PrCommit[] }) {
  return (
    <div className="detail-section">
      <span className="detail-label">
        {tp('Commits ({count})', { count: commits.length })}
      </span>
      <div className="pr-detail-list">
        {commits.map((commit) => (
          <div key={commit.sha} className="pr-detail-item">
            <span className="hash">{shortHash(commit.sha)}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {commit.commit.message.split('\n')[0]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ReviewersSection({
  canRequest,
  reviewers,
  input,
  onInput,
  onRequest,
}: {
  canRequest: boolean;
  reviewers: Reviewer[];
  input: string;
  onInput: (value: string) => void;
  onRequest: () => void;
}) {
  return (
    <div className="detail-section">
      <span className="detail-label">{tp('Reviewers ({count})', { count: reviewers.length })}</span>
      {reviewers.length === 0 ? (
        <div className="detail-value muted">{t('No reviewers requested yet.')}</div>
      ) : (
        <div className="reviewer-list">
          {reviewers.map((reviewer) => (
            <span key={reviewer.login} className="reviewer-chip">
              {reviewer.avatar_url
                ? <img src={reviewer.avatar_url} alt="" width={18} height={18} />
                : <span className="reviewer-avatar">{reviewer.login.slice(0, 1).toUpperCase()}</span>}
              {reviewer.login}
            </span>
          ))}
        </div>
      )}
      {canRequest && (
        <div className="reviewer-add">
          <input
            value={input}
            placeholder={t('GitHub username…')}
            aria-label={t('GitHub username')}
            onChange={(event) => onInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onRequest();
              }
            }}
          />
          <button type="button" className="btn" onClick={onRequest}>{t('Request')}</button>
        </div>
      )}
    </div>
  );
}

function IconClock() {
  return <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />;
}

export function ChecksSection({
  checks,
  failedChecks,
}: {
  checks: CheckRun[];
  failedChecks: number;
}) {
  return (
    <div className="detail-section">
      <span className="detail-label">
        {t('Checks')}{failedChecks > 0 ? ` · ${failedChecks} failing` : ''}
      </span>
      {checks.length === 0 ? (
        <div className="detail-value muted">{t('No check runs reported.')}</div>
      ) : (
        <div className="pr-detail-list">
          {checks.map((check) => (
            <div key={check.id} className="pr-detail-item">
              <span style={{
                color: check.conclusion === 'success' ? 'var(--green)'
                  : check.conclusion === null ? 'var(--yellow)' : 'var(--red)',
              }}>
                {check.conclusion === null ? <IconClock /> : check.conclusion === 'success' ? <IconCheck width={14} height={14} /> : <IconX width={14} height={14} />}
              </span>
              <span style={{ flex: 1 }}>{check.name}</span>
              <span className="detail-value muted">{check.conclusion || check.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export interface PrComment {
  id: number;
  user: { login: string; avatar_url: string };
  body: string;
  created_at: string;
  author_association: string;
}

export function DescriptionSection({
  state,
  body,
  editing,
  draft,
  working,
  onStart,
  onDraft,
  onCancel,
  onSave,
}: {
  state: string;
  body: string | null | undefined;
  editing: boolean;
  draft: string;
  working: boolean;
  onStart: () => void;
  onDraft: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="detail-section">
      <span className="detail-label">
        {t('Description')}{state === 'open' && !editing && (
          <button
            type="button"
            className="comment-tool-btn"
            style={{ marginLeft: 8 }}
            onClick={onStart}
          >
            {t('Edit')}</button>
        )}
      </span>
      {editing ? (
        <div className="review-inline-composer">
          <textarea
            value={draft}
            autoFocus
            rows={4}
            aria-label={t('Pull request description')}
            onChange={(event) => onDraft(event.target.value)}
          />
          <div className="review-composer-actions">
            <button type="button" className="btn" onClick={onCancel} disabled={working}>
              {t('Cancel')}</button>
            <button type="button" className="btn btn-primary" onClick={onSave} disabled={working}>
              {working ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : body ? (
        <div className="pr-description">{body}</div>
      ) : (
        <div className="detail-value muted">{t('No description provided.')}</div>
      )}
    </div>
  );
}

export function CommentsSection({
  comments,
  editingId,
  editBody,
  editWorking,
  commentBody,
  posting,
  onStartEdit,
  onEditBody,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onCommentBody,
  onPost,
}: {
  comments: PrComment[];
  editingId: number | null;
  editBody: string;
  editWorking: boolean;
  commentBody: string;
  posting: boolean;
  onStartEdit: (comment: PrComment) => void;
  onEditBody: (value: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (comment: PrComment) => void;
  onDelete: (comment: PrComment) => void;
  onCommentBody: (value: string) => void;
  onPost: () => void;
}) {
  return (
    <div className="detail-section">
      <span className="detail-label">{tp('Comments ({count})', { count: comments.length })}</span>
      {comments.length === 0 ? (
        <div className="detail-value muted">{t('No comments yet.')}</div>
      ) : (
        <div className="comment-list">
          {comments.map((comment) => (
            <div key={comment.id} className="comment-item">
              {comment.user.avatar_url
                ? <img className="comment-avatar" src={comment.user.avatar_url} alt="" width={24} height={24} />
                : <span className="detail-avatar">{comment.user.login.slice(0, 1).toUpperCase()}</span>}
              <div className="comment-body">
                <div className="comment-head">
                  <span className="comment-user">{comment.user.login}</span>
                  <span className="detail-value muted">{formatRelative(comment.created_at)}</span>
                  {editingId !== comment.id && (
                    <span className="comment-tools">
                      <button
                        type="button"
                        className="comment-tool-btn"
                        title={t('Edit comment')}
                        onClick={() => onStartEdit(comment)}
                        disabled={editWorking}
                      >
                        {t('Edit')}</button>
                      <button
                        type="button"
                        className="comment-tool-btn danger"
                        title={t('Delete comment')}
                        onClick={() => onDelete(comment)}
                        disabled={editWorking}
                      >
                        {t('Delete')}</button>
                    </span>
                  )}
                </div>
                {editingId === comment.id ? (
                  <div className="comment-edit">
                    <textarea
                      value={editBody}
                      autoFocus
                      onChange={(event) => onEditBody(event.target.value)}
                      aria-label={t('Edit comment body')}
                    />
                    <div className="comment-edit-actions">
                      <button type="button" className="btn" onClick={onCancelEdit} disabled={editWorking}>
                        {t('Cancel')}</button>
                      <button type="button" className="btn btn-primary" onClick={() => onSaveEdit(comment)} disabled={editWorking}>
                        {editWorking ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="comment-text">{comment.body}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="comment-compose">
        <textarea
          value={commentBody}
          placeholder={t('Write a comment…')}
          rows={2}
          aria-label={t('Comment body')}
          onChange={(event) => onCommentBody(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              onPost();
            }
          }}
        />
        <div className="comment-compose-side">
          <span className="hint">{t('Cmd/Ctrl+Enter to post')}</span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={posting || !commentBody.trim()}
            onClick={onPost}
          >
            {posting ? 'Posting…' : 'Comment'}
          </button>
        </div>
      </div>
    </div>
  );
}

export type MergeMethod = 'merge' | 'squash' | 'rebase';

export const MERGE_INFO: Record<MergeMethod, { name: string; desc: string }> = {
  merge: { name: 'Merge commit', desc: 'Preserve all commits and add a merge commit' },
  squash: { name: 'Squash and merge', desc: 'Combine all commits into one new commit' },
  rebase: { name: 'Rebase and merge', desc: 'Replay commits onto the base without a merge commit' },
};

export interface ProtectionInfo {
  protected: boolean | null;
  requiredChecks: number;
}

export function MergeSection({
  pr,
  failedChecks,
  protection,
  method,
  onMethod,
}: {
  pr: PullRequest;
  failedChecks: number;
  protection: ProtectionInfo | null;
  method: MergeMethod;
  onMethod: (method: MergeMethod) => void;
}) {
  if (pr.state !== 'open') return null;
  return (
    <div className="detail-section">
      <span className="detail-label">{t('Merge method')}</span>
      {(!pr.merged && !pr.merged_at) && (failedChecks > 0 || protection?.protected === false || (protection?.protected === true && protection.requiredChecks > 0)) && (
        <div className="ci-gate">
          {failedChecks > 0 && (
            <div className="ci-gate-row danger">
              <IconX width={14} height={14} />
              <span>
                {failedChecks} failing check{failedChecks === 1 ? '' : 's'} on {shortHash(pr.head.sha)} — GitHub will reject the merge if these are required.
              </span>
            </div>
          )}
          {protection?.protected === false && (
            <div className="ci-gate-row">
              <span>
                Branch <strong>{pr.base.ref}</strong> has no protection rules — direct pushes and force-pushes are allowed. Consider enabling branch protection on GitHub.
              </span>
            </div>
          )}
          {protection?.protected === true && protection.requiredChecks > 0 && (
            <div className="ci-gate-row muted">
              {protection.requiredChecks} required status check{protection.requiredChecks === 1 ? '' : 's'} on {pr.base.ref}.
            </div>
          )}
        </div>
      )}
      <div className="merge-options">
        {(Object.keys(MERGE_INFO) as MergeMethod[]).map((option) => (
          <button
            key={option}
            type="button"
            className={`merge-option${method === option ? ' active' : ''}`}
            onClick={() => onMethod(option)}
          >
            {option === 'merge' ? <IconMerge width={17} height={17} />
              : option === 'squash' ? <IconRocket width={17} height={17} />
              : <IconCheck width={17} height={17} />}
            <span>
              <span className="merge-name">{MERGE_INFO[option].name}</span>
              <span className="merge-desc" style={{ display: 'block' }}>
                {MERGE_INFO[option].desc}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
