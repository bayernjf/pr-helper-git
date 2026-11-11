import { useMemo } from 'react';
import type { Ref } from '../types';
import { IconCopy, IconRevert, IconSearch, IconX } from './icons';
import { t, tp } from '../i18n';

export function edgePath(x0: number, y0: number, x1: number, y1: number): string {
  if (x0 === x1) return `M ${x0} ${y0} L ${x1} ${y1}`;
  const bend = Math.max(12, (y1 - y0) * 0.42);
  return `M ${x0} ${y0} C ${x0} ${y0 + bend}, ${x1} ${y1 - bend}, ${x1} ${y1}`;
}

function classify(ref: Ref): 'head' | 'branch' | 'remote' | 'tag' {
  if (ref.name.startsWith('refs/tags/')) return 'tag';
  if (ref.name.startsWith('refs/remotes/')) return 'remote';
  return 'branch';
}

export function RefBadges({
  hash,
  refs,
  currentBranch,
}: {
  hash: string;
  refs: Ref[];
  currentBranch: string | null | undefined;
}) {
  const matching = useMemo(() => refs.filter((r) => r.hash === hash), [refs, hash]);
  const headRef = refs.find((r) => r.name === `refs/heads/${currentBranch}`);

  const ordered = matching
    .filter((r) => !r.name.startsWith('refs/stash'))
    .sort((a, b) => classify(a).localeCompare(classify(b)));

  return (
    <span className="ref-badges">
      {headRef?.hash === hash && <span className="ref-badge head">{t("HEAD")}</span>}
      {ordered.map((ref) => (
        <span key={ref.name} className={`ref-badge ${classify(ref)}`}>
          {ref.shortName}
        </span>
      ))}
    </span>
  );
}

export function GraphToolbar({
  search,
  onSearch,
  shownCount,
  totalCount,
  pathDraft,
  onPathDraft,
  onPathApply,
  filterCount,
  onOpenFilter,
  logScope,
  onScopeChange,
}: {
  search: string;
  onSearch: (value: string) => void;
  shownCount: number;
  totalCount: number;
  pathDraft: string;
  onPathDraft: (value: string) => void;
  onPathApply: (path: string) => void;
  filterCount: number;
  onOpenFilter: () => void;
  logScope: 'all' | 'current';
  onScopeChange: (scope: 'all' | 'current') => void;
}) {
  return (
    <div className="graph-toolbar">
      <div className="graph-search">
        <IconSearch width={14} height={14} />
        <input
          value={search}
          placeholder={t("Filter commits by message, author or hash…")}
          onChange={(e) => onSearch(e.target.value)}
        />
        {search && (
          <button type="button" className="icon-btn" style={{ width: 22, height: 22 }} aria-label={t("Clear commit filter")} title={t("Clear filter")} onClick={() => onSearch('')}>
            <IconX width={12} height={12} />
          </button>
        )}
      </div>
      <span className="graph-search-count">
        {tp("Showing {shown} of {total}", { shown: shownCount, total: totalCount })}
      </span>
      <div className="graph-path-filter">
        <input
          value={pathDraft}
          placeholder={t("Filter by path…")}
          title={t("Show only commits touching this path (git log -- path); Enter to apply")}
          onChange={(e) => onPathDraft(e.target.value)}
          onBlur={() => onPathApply(pathDraft.trim())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onPathApply(pathDraft.trim());
          }}
        />
        {pathDraft && (
          <button
            type="button"
            className="icon-btn"
            style={{ width: 22, height: 22 }}
            aria-label={t("Clear path filter")}
            title={t("Clear path filter")}
            onClick={() => {
              onPathDraft('');
              onPathApply('');
            }}
          >
            <IconX width={12} height={12} />
          </button>
        )}
      </div>
      <button
        type="button"
        className={`graph-filter-btn${filterCount ? ' active' : ''}`}
        title={t("Filter history by author, message or date")}
        onClick={onOpenFilter}
      >
        {t("Filters")}{filterCount ? ` (${filterCount})` : ''}
      </button>
      <span className="scope-toggle" role="group" aria-label={t("History scope")}>
        <button
          type="button"
          className={logScope === 'all' ? 'active' : ''}
          onClick={() => onScopeChange('all')}
          title={t("Show history across every branch")}
        >
          {t("All branches")}
        </button>
        <button
          type="button"
          className={logScope === 'current' ? 'active' : ''}
          onClick={() => onScopeChange('current')}
          title={t("Follow only the current branch history")}
        >
          {t("Current branch")}
        </button>
      </span>
    </div>
  );
}

export function BatchBar({
  count,
  onRevert,
  onCopy,
  onClear,
}: {
  count: number;
  onRevert: () => void;
  onCopy: () => void;
  onClear: () => void;
}) {
  return (
    <div className="batch-bar" role="group" aria-label={t("Batch actions for selected commits")}>
      <span className="batch-count">{t(`${count} selected`)}</span>
      <button
        type="button"
        className="btn btn-primary"
        disabled={count < 2}
        title={count < 2 ? t('Select at least two commits') : t('Revert all selected commits')}
        onClick={onRevert}
      >
        <IconRevert width={14} height={14} /> {t("Revert")}
      </button>
      <button type="button" className="btn" onClick={onCopy}>
        <IconCopy width={14} height={14} /> {t("Copy SHAs")}
      </button>
      <button
        type="button"
        className="icon-btn"
        title={t("Clear selection")}
        onClick={onClear}
      >
        <IconX width={14} height={14} />
      </button>
    </div>
  );
}
