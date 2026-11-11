import { useState, type MouseEvent, type ReactNode } from 'react';
import { useEscape } from '../hooks/use-escape';
import { IconChevronDown, IconChevronRight, IconMore, IconX } from './icons';
import type { TagDetail } from '../api';
import type { Ref } from '../types';
import { t } from '../i18n';

export function GroupHead({
  label,
  count,
  open,
  onToggle,
  action,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  action?: ReactNode;
}) {
  return (
    <div className="ref-group-head" style={{ paddingRight: 10 }}>
      <button type="button" className="ref-group-head" style={{ padding: 0, flex: 1 }} onClick={onToggle}>
        <span className="chev">{open ? <IconChevronDown width={13} height={13} /> : <IconChevronRight width={13} height={13} />}</span>
        {label}
        <span className="count">{count}</span>
      </button>
      {action}
    </div>
  );
}

export function Row({
  icon,
  name,
  current,
  badge,
  onOpen,
  onMenu,
}: {
  icon: ReactNode;
  name: string;
  current?: boolean;
  badge?: ReactNode;
  onOpen: () => void;
  onMenu: (e: MouseEvent) => void;
}) {
  return (
    <div className={`ref-row${current ? ' current' : ''}`} onClick={onOpen} title={name}>
      <span className="ref-icon">{icon}</span>
      <span className="ref-name">{name}</span>
      {badge}
      <button
        type="button"
        className="row-more"
        aria-label={`Actions for ${name}`}
        title={t("More actions")}
        onClick={(e) => {
          e.stopPropagation();
          onMenu(e);
        }}
      >
        <IconMore width={15} height={15} />
      </button>
    </div>
  );
}

export function RenameModal({
  current,
  onCancel,
  onSubmit,
}: {
  current: string;
  onCancel: () => void;
  onSubmit: (next: string) => void;
}) {
  const [value, setValue] = useState(current);
  useEscape(onCancel);
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form
        className="modal"
        style={{ width: 420 }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSubmit(value.trim());
        }}
      >
        <div className="modal-header"><h2>{t("Rename branch")}</h2></div>
        <div className="modal-body">
          <div className="form-group">
            <label>{t("New name")}</label>
            <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onCancel}>{t("Cancel")}</button>
          <button type="submit" className="btn btn-primary" disabled={!value.trim() || value === current}>
            Rename
          </button>
        </div>
      </form>
    </div>
  );
}

/** git submodule status prefix letters, mapped to display copy. */
export function submoduleLabel(state: string): string {
  switch (state) {
    case ' ': return t('Up to date');
    case '-': return t('Not initialized');
    case '+': return t('Modified');
    case 'U': return t('Conflicted');
    default: return t('Unknown');
  }
}

export function submoduleColor(state: string): string {
  if (state === ' ') return 'var(--green)';
  if (state === '-') return 'var(--text-dim)';
  if (state === '+') return 'var(--amber)';
  return 'var(--red)';
}

export function MergeBanners({
  rebaseInProgress,
  revertInProgress,
  mergeInProgress,
  unmergedCount,
  onResolve,
  onContinueRebase,
  onAbortRebase,
  onContinueRevert,
  onAbortRevert,
  onAbortMerge,
}: {
  rebaseInProgress: boolean;
  revertInProgress: boolean;
  mergeInProgress: boolean;
  unmergedCount: number;
  onResolve: () => void;
  onContinueRebase: () => void;
  onAbortRebase: () => void;
  onContinueRevert: () => void;
  onAbortRevert: () => void;
  onAbortMerge: () => void;
}) {
  return (
    <>
      {rebaseInProgress && (
        <div className="merge-banner rebase-banner">
          <span className="merge-banner-msg">{t("Rebase in progress — resolve conflicts, then continue or abort")}</span>
          <div className="banner-actions">
            {unmergedCount > 0 && (
              <button type="button" className="btn" onClick={onResolve}>
                Resolve conflicts ({unmergedCount})
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={onContinueRebase}>
              Continue rebase
            </button>
            <button type="button" className="btn btn-danger" onClick={onAbortRebase}>
              Abort rebase
            </button>
          </div>
        </div>
      )}
      {revertInProgress && (
        <div className="merge-banner revert-banner">
          <span className="merge-banner-msg">
            Revert in progress{unmergedCount ? ` — ${unmergedCount} conflicting file${unmergedCount === 1 ? '' : 's'} to resolve` : ''}
          </span>
          <div className="banner-actions">
            {unmergedCount > 0 && (
              <button type="button" className="btn" onClick={onResolve}>
                Resolve conflicts ({unmergedCount})
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={onContinueRevert}>
              Continue revert
            </button>
            <button type="button" className="btn btn-danger" onClick={onAbortRevert}>
              Abort revert
            </button>
          </div>
        </div>
      )}
      {mergeInProgress && (
        <div className="merge-banner">
          <span className="merge-banner-msg">{t("Merge in progress — resolve conflicts or abort")}</span>
          <div className="banner-actions">
            {unmergedCount > 0 && (
              <button type="button" className="btn" onClick={onResolve}>
                Resolve conflicts ({unmergedCount})
              </button>
            )}
            <button type="button" className="btn btn-danger" onClick={onAbortMerge}>
              Abort merge
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export function StashViewModal({
  view,
  onClose,
}: {
  view: { index: number; subject: string; diff: string };
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        style={{ width: '86vw', height: '82vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>stash@{view.index} — {view.subject}</h2>
          <button type="button" className="icon-btn" aria-label={t("Close stash")} title={t("Close")} onClick={onClose}>
            <IconX />
          </button>
        </div>
        <pre className="diff stash-diff" style={{ flex: 1, minHeight: 0, overflow: 'auto', margin: 0 }}>
          {view.diff.split('\n').map((line, i) => (
            <div
              key={i}
              className={`patch-line${
                line.startsWith('+++') || line.startsWith('---') ? ' patch-meta'
                  : line.startsWith('+') ? ' patch-add'
                    : line.startsWith('-') ? ' patch-del'
                      : line.startsWith('@@') ? ' patch-hunk' : ''
              }`}
            >
              {line || ' '}
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}

export function TagViewModal({ tag, onClose }: { tag: TagDetail; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{tag.tag}</h2>
          <button type="button" className="icon-btn" aria-label={t("Close tag")} title={t("Close")} onClick={onClose}>
            <IconX />
          </button>
        </div>
        <div className="modal-body">
          <div className="tag-detail-grid">
            <span className="detail-label">{t("Tagger")}</span>
            <span className="detail-value">{tag.tagger}</span>
            <span className="detail-label">{t("Email")}</span>
            <span className="detail-value muted">{tag.taggerEmail}</span>
            <span className="detail-label">{t("Date")}</span>
            <span className="detail-value muted">
              {new Date(tag.time * 1000).toLocaleString()}
            </span>
            <span className="detail-label">{t("Target")}</span>
            <span className="detail-value mono-small">{tag.object}</span>
          </div>
          <div className="tag-message">
            <div className="detail-label" style={{ marginBottom: 6 }}>{t("Message")}</div>
            <div className="tag-subject">{tag.subject}</div>
            {tag.body && <div className="tag-body muted">{tag.body}</div>}
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function UpstreamPickerModal({
  branch,
  remotes,
  onPick,
  onClose,
}: {
  branch: string;
  remotes: Ref[];
  onPick: (remoteShortName: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Set upstream for {branch}</h2>
          <button type="button" className="icon-btn" aria-label={t("Close upstream picker")} title={t("Close")} onClick={onClose}>
            <IconX />
          </button>
        </div>
        <div className="modal-body">
          {remotes.length === 0 ? (
            <div className="list-empty">{t("No remote tracking branches available.")}</div>
          ) : (
            <div className="pr-detail-list">
              {remotes.map((r) => (
                <button
                  key={r.name}
                  type="button"
                  className="pr-detail-item"
                  style={{ width: '100%', textAlign: 'left' }}
                  onClick={() => onPick(r.shortName)}
                >
                  {r.shortName}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
