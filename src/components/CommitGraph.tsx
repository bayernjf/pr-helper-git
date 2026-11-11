import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cherryPick, resetCommit, revertCommit, revertCommitsBatch, undoLastCommit } from '../api';
import { useApp, LOG_MAX } from '../app-state';
import { isGraphNavKey, nextCommitIndex, pageSizeForViewport } from '../lib/graph-nav';
import { layoutGraph } from '../lib/graph-layout';
import { formatRelative, shortHash } from '../lib/format';
import { windowRange } from '../lib/virtual-range';
import type { Ref } from '../types';
import { ContextMenu, type MenuItem } from './context-menu';
import RebaseModal from './RebaseModal';
import {
  IconBranch,
  IconCommit,
  IconCopy,
  IconRevert,
  IconSearch,
  IconTag,
  IconX,
} from './icons';
import NewBranchModal from './NewBranchModal';
import RevertMergeModal from './RevertMergeModal';
import TagModal from './TagModal';
import LogFilterModal from './LogFilterModal';
import { useConfirm } from './ui';
import { t, tp } from '../i18n';
import { useCiBySha } from '../hooks/use-ci-by-sha';

const ROW_H = 34;
const COL_W = 20;
const PAD_X = 14;

const LANE_COLORS = [
  '#4f9dff',
  '#3fb950',
  '#d29922',
  '#bc8cff',
  '#f778ba',
  '#39c5cf',
  '#f0883e',
  '#7ee787',
];

export function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length];
}

function edgePath(x0: number, y0: number, x1: number, y1: number): string {
  if (x0 === x1) return `M ${x0} ${y0} L ${x1} ${y1}`;
  const bend = Math.max(12, (y1 - y0) * 0.42);
  return `M ${x0} ${y0} C ${x0} ${y0 + bend}, ${x1} ${y1 - bend}, ${x1} ${y1}`;
}

function classify(ref: Ref): 'head' | 'branch' | 'remote' | 'tag' {
  if (ref.name.startsWith('refs/tags/')) return 'tag';
  if (ref.name.startsWith('refs/remotes/')) return 'remote';
  return 'branch';
}

function RefBadges({ hash }: { hash: string }) {
  const { refs, status } = useApp();
  const matching = useMemo(() => refs.filter((r) => r.hash === hash), [refs, hash]);
  const currentBranch = status?.branch;
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

interface MenuState {
  x: number;
  y: number;
  hash: string;
}

export default function CommitGraph() {
  const {
    pat,
    remote,
    commits,
    selectedHash,
    selectCommit,
    currentRepo,
    toast,
    loadMore,
    logLimit,
    logScope,
    setLogScope,
    logPath,
    setLogPath,
    logFilters,
    repoLoading,
    runAction,
  } = useApp();
  const confirm = useConfirm();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [branchFrom, setBranchFrom] = useState<string | null>(null);
  const [tagFrom, setTagFrom] = useState<string | null>(null);
  const [revertMerge, setRevertMerge] = useState<{ hash: string; parentCount: number } | null>(null);
  const [rebaseBase, setRebaseBase] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [pathDraft, setPathDraft] = useState('');
  const [filterModal, setFilterModal] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const filterCount = Object.values(logFilters).filter(Boolean).length;

  // Batch selection belongs to one repository; drop it when switching repos.
  useEffect(() => { setChecked(new Set()); }, [currentRepo]);

  const ciBySha = useCiBySha(pat, remote, currentRepo);

  function toggleChecked(hash: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });
  }

  // Keep the draft aligned when the active path changes externally (repo switch).
  useEffect(() => { setPathDraft(logPath); }, [logPath, currentRepo]);

  const visibleCommits = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return commits;
    return commits.filter((c) =>
      c.subject.toLowerCase().includes(term)
      || c.authorName.toLowerCase().includes(term)
      || c.hash.toLowerCase().includes(term));
  }, [commits, search]);

  const layout = useMemo(() => layoutGraph(visibleCommits), [visibleCommits]);
  const lanes = layout.lanes;
  const graphWidth = Math.max(70, lanes * COL_W + PAD_X * 2);
  const totalHeight = visibleCommits.length * ROW_H;

  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<HTMLDivElement | null>(null);
  // Only the rows around the viewport are mounted; the graph keeps its full
  // height so the scrollbar still represents the whole history.
  const [range, setRange] = useState({ start: 0, end: 40 });

  const measureRange = useCallback(() => {
    const scroller = scrollRef.current;
    const graph = graphRef.current;
    if (!scroller || !graph) return;
    // Distance from the scroll container's content top to the first graph row
    // (the toolbar above the graph scrolls with the content).
    const offset = graph.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const top = Math.max(0, scroller.scrollTop - offset);
    const next = windowRange(visibleCommits.length, top, scroller.clientHeight, ROW_H);
    setRange((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  }, [visibleCommits.length]);

  useEffect(() => {
    measureRange();
    window.addEventListener('resize', measureRange);
    return () => window.removeEventListener('resize', measureRange);
  }, [measureRange]);

  // Bring a row into the visible area of the scrolling graph container.
  function revealRow(hash: string) {
    const row = layout.rowOf.get(hash);
    const scroller = scrollRef.current;
    const graph = graphRef.current;
    if (row === undefined || !scroller || !graph) return;
    const offset = graph.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const rowTop = offset + row * ROW_H;
    if (rowTop < scroller.scrollTop + ROW_H || rowTop > scroller.scrollTop + scroller.clientHeight - ROW_H * 2) {
      scroller.scrollTop = Math.max(0, rowTop - scroller.clientHeight / 2);
    }
    // The row mounts after this scroll; focus it on the next frame.
    requestAnimationFrame(() => rowRefs.current.get(hash)?.focus());
  }

  // Keyboard navigation over the visible commits. Roving tabindex keeps the
  // graph a single tab stop while arrow/page keys move the selection.
  function onGraphKeyDown(event: React.KeyboardEvent) {
    const count = visibleCommits.length;
    if (!count) return;
    const currentIndex = visibleCommits.findIndex((c) => c.hash === selectedHash);

    if (event.key === 'Enter' && event.shiftKey) {
      // Shift+Enter jumps from the graph to the whole-history search.
      event.preventDefault();
      window.dispatchEvent(new CustomEvent('git2:search-commits'));
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      // Stop the space bar from scrolling the page while the graph has focus.
      event.preventDefault();
      if (currentIndex >= 0) selectCommit(visibleCommits[currentIndex].hash);
      return;
    }
    if (!isGraphNavKey(event.key)) return;

    event.preventDefault();
    const pageSize = pageSizeForViewport(scrollRef.current?.clientHeight ?? 0, ROW_H);
    const nextIndex = nextCommitIndex(event.key, currentIndex, count, pageSize);
    if (nextIndex === null) {
      // Escape: clear the selection and keep focus on the list itself.
      selectCommit(null);
      graphRef.current?.focus();
      return;
    }
    const target = visibleCommits[nextIndex];
    if (!target) return;
    selectCommit(target.hash);
    revealRow(target.hash);
    rowRefs.current.get(target.hash)?.focus();
  }

  const edges = useMemo(() => {
    const out: Array<{ key: string; d: string; color: string; fromRow: number; toRow: number }> = [];
    layout.commits.forEach((commit, row) => {
      const x = PAD_X + commit.lane * COL_W;
      const y = row * ROW_H + ROW_H / 2;
      for (const parent of commit.parents) {
        const parentRow = layout.rowOf.get(parent);
        const parentLane = layout.laneOf.get(parent);
        if (parentRow === undefined || parentLane === undefined) continue;
        const px = PAD_X + parentLane * COL_W;
        const py = parentRow * ROW_H + ROW_H / 2;
        out.push({
          key: `${commit.hash}-${parent}`,
          d: edgePath(x, y, px, py),
          color: laneColor(commit.lane),
          fromRow: row,
          toRow: parentRow,
        });
      }
    });
    return out;
  }, [layout]);

  // Edges whose row span (child row → parent row) overlaps the mounted window.
  const windowEdges = useMemo(
    () => edges.filter((e) => e.fromRow <= range.end && e.toRow >= range.start),
    [edges, range],
  );

  const menuItems: MenuItem[] = [
    { id: 'copy', label: 'Copy full hash', icon: <IconCopy width={15} height={15} /> },
    { separator: true },
    { id: 'reset-soft', label: 'Reset branch (soft)' },
    { id: 'reset-mixed', label: 'Reset branch (mixed)' },
    { id: 'reset-hard', label: 'Reset branch (hard)', danger: true },
    { separator: true },
    { id: 'revert', label: 'Revert commit (new commit)', icon: <IconRevert width={15} height={15} /> },
    { id: 'cherry-pick', label: 'Cherry-pick onto current branch' },
    { id: 'rebase-i', label: 'Interactive rebase from here' },
    ...(menu && commits[0] && menu.hash === commits[0].hash
      ? [{ id: 'undo', label: 'Undo last commit (keep changes staged)' }]
      : []),
    { separator: true },
    { id: 'branch', label: 'Create branch here', icon: <IconBranch width={15} height={15} /> },
    { id: 'tag', label: 'Create tag here', icon: <IconTag width={15} height={15} /> },
  ];

  async function handleReset(mode: 'soft' | 'mixed' | 'hard') {
    if (!menu || !currentRepo) return;
    const sha = menu.hash;
    if (mode === 'hard') {
      const yes = await confirm(
        'Hard reset to this commit?',
        'git reset --hard moves the branch and discards index and working-tree changes permanently.',
      );
      if (!yes) return;
    }
    await runAction(
      resetCommit(currentRepo, sha, mode, mode === 'hard'),
      `Reset (${mode})`,
    );
  }

  const onMenuSelect = async (id: string) => {
    if (!menu) return;
    if (id === 'copy') {
      navigator.clipboard?.writeText(menu.hash).then(
        () => toast(t("Hash copied to clipboard"), 'success'),
        () => toast(t("Copy failed"), 'error'),
      );
    } else if (id === 'reset-soft') {
      setMenu(null);
      return handleReset('soft');
    } else if (id === 'reset-mixed') {
      setMenu(null);
      return handleReset('mixed');
    } else if (id === 'reset-hard') {
      setMenu(null);
      return handleReset('hard');
    } else if (id === 'revert') {
      const hash = menu.hash;
      const target = commits.find((c) => c.hash === hash);
      setMenu(null);
      if (target && target.parents.length > 1) {
        setRevertMerge({ hash, parentCount: target.parents.length });
        return;
      }
      const yes = await confirm(
        'Revert this commit?',
        'git revert creates a new commit that undoes the change; history is not rewritten.',
      );
      if (yes) await runAction(revertCommit(currentRepo!, hash), 'Commit reverted');
      return;
    } else if (id === 'cherry-pick') {
      const hash = menu.hash;
      setMenu(null);
      const yes = await confirm(
        'Cherry-pick this commit onto the current branch?',
        'git cherry-pick applies the change as a new commit here; a conflict leaves the repository in the cherry-picking state.',
      );
      if (yes) await runAction(cherryPick(currentRepo!, hash), 'Commit cherry-picked');
      return;
    } else if (id === 'rebase-i') {
      const hash = menu.hash;
      const target = commits.find((c) => c.hash === hash);
      setMenu(null);
      // Rewriting everything newer than this commit: a root commit has no
      // parent to anchor onto, so the whole branch is the range.
      setRebaseBase(target && target.parents.length === 0 ? 'root' : hash);
      return;
    } else if (id === 'undo') {
      setMenu(null);
      const yes = await confirm(
        'Undo the last commit?',
        'git reset --soft HEAD~1 removes the commit but keeps every change staged, ready to recommit.',
      );
      if (yes) await runAction(undoLastCommit(currentRepo!), 'Last commit undone (changes staged)');
      return;
    } else if (id === 'branch') {
      setBranchFrom(menu.hash);
    } else if (id === 'tag') {
      setTagFrom(menu.hash);
    }
    setMenu(null);
  };

  const canLoadMore = !search.trim() && logLimit < LOG_MAX && commits.length >= logLimit;

  async function handleBatchRevert() {
    if (!currentRepo || checked.size < 2) return;
    const hasMerge = [...checked].some((hash) => {
      const target = commits.find((c) => c.hash === hash);
      return target && target.parents.length > 1;
    });
    if (hasMerge) {
      toast(t("Merge commits cannot be batch reverted; revert them individually"), 'error');
      return;
    }
    const yes = await confirm(
      t(`Revert ${checked.size} commits?`),
      'git revert creates one new commit per selected change; history is not rewritten.',
    );
    if (!yes) return;
    // Order the selection newest-first (the order the graph lists commits).
    // Checkbox clicks arrive in arbitrary order, and `git revert` applies each
    // commit in sequence, so reverting an older commit first can conflict with
    // changes that the newer, still-present commits introduced.
    const ordered = commits
      .filter((c) => checked.has(c.hash))
      .map((c) => c.hash);
    const result = await runAction(
      revertCommitsBatch(currentRepo, ordered),
      t(`Reverted ${checked.size} commits`),
    );
    if (result !== null) setChecked(new Set());
  }

  function handleBatchCopy() {
    const shas = [...checked].join('\n');
    navigator.clipboard?.writeText(shas).then(
      () => toast(`${checked.size} SHAs copied to clipboard`, 'success'),
      () => toast(t("Copy failed"), 'error'),
    );
  }

  if (!commits.length) {
    return (
      <div className="graph-scroll">
        <div className="empty-state">
          <div className="empty-icon"><IconCommit width={28} height={28} /></div>
          <h3>{t("No commits yet")}</h3>
          <p>{t("Stage files below and create the first commit to see the graph.")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="graph-scroll" ref={scrollRef} onScroll={measureRange}>
      <div className="graph-toolbar">
        <div className="graph-search">
          <IconSearch width={14} height={14} />
          <input
            value={search}
            placeholder={t("Filter commits by message, author or hash…")}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button type="button" className="icon-btn" style={{ width: 22, height: 22 }} aria-label={t("Clear commit filter")} title={t("Clear filter")} onClick={() => setSearch('')}>
              <IconX width={12} height={12} />
            </button>
          )}
        </div>
        <span className="graph-search-count">
          {tp("Showing {shown} of {total}", { shown: visibleCommits.length, total: commits.length })}
        </span>
        <div className="graph-path-filter">
          <input
            value={pathDraft}
            placeholder={t("Filter by path…")}
            title={t("Show only commits touching this path (git log -- path); Enter to apply")}
            onChange={(e) => setPathDraft(e.target.value)}
            onBlur={() => setLogPath(pathDraft.trim())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setLogPath(pathDraft.trim());
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
                setPathDraft('');
                setLogPath('');
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
          onClick={() => setFilterModal(true)}
        >
          {t("Filters")}{filterCount ? ` (${filterCount})` : ''}
        </button>
        <span className="scope-toggle" role="group" aria-label={t("History scope")}>
          <button
            type="button"
            className={logScope === 'all' ? 'active' : ''}
            onClick={() => setLogScope('all')}
            title={t("Show history across every branch")}
          >
            {t("All branches")}
          </button>
          <button
            type="button"
            className={logScope === 'current' ? 'active' : ''}
            onClick={() => setLogScope('current')}
            title={t("Follow only the current branch history")}
          >
            {t("Current branch")}
          </button>
        </span>
      </div>

      <div
        ref={graphRef}
        className="graph"
        role="listbox"
        aria-label={t("Commit history")}
        aria-activedescendant={selectedHash ? `commit-row-${selectedHash}` : undefined}
        tabIndex={0}
        onKeyDown={onGraphKeyDown}
        style={{ width: graphWidth, minWidth: '100%', height: totalHeight }}
      >
        <svg className="graph-svg" width={graphWidth} height={totalHeight}>
          {windowEdges.map((e) => (
            <path key={e.key} d={e.d} fill="none" stroke={e.color} strokeWidth={2} />
          ))}
          {layout.commits.slice(range.start, range.end).map((commit, index) => {
            const row = range.start + index;
            const x = PAD_X + commit.lane * COL_W;
            const y = row * ROW_H + ROW_H / 2;
            const isMerge = commit.parents.length > 1;
            const isRoot = commit.parents.length === 0;
            const color = laneColor(commit.lane);
            if (isMerge) {
              return (
                <g key={commit.hash}>
                  <circle cx={x} cy={y} r={6.5} fill="#15151c" stroke={color} strokeWidth={2.2} />
                  <circle cx={x} cy={y} r={2.4} fill={color} />
                </g>
              );
            }
            return (
              <circle
                key={commit.hash}
                cx={x}
                cy={y}
                r={isRoot ? 5 : 4.5}
                fill={color}
                stroke="#15151c"
                strokeWidth={1.5}
              />
            );
          })}
        </svg>

        {layout.commits.slice(range.start, range.end).map((commit, index) => {
          const row = range.start + index;
          return (
          <div
            key={commit.hash}
            ref={(el) => {
              if (el) rowRefs.current.set(commit.hash, el);
              else rowRefs.current.delete(commit.hash);
            }}
            role="option"
            id={`commit-row-${commit.hash}`}
            aria-selected={selectedHash === commit.hash}
            tabIndex={-1}
            className={`graph-row${selectedHash === commit.hash ? ' selected' : ''}`}
            style={{ top: row * ROW_H, position: 'absolute', left: 0, right: 0 }}
            onClick={() => selectCommit(commit.hash)}
            onContextMenu={(e) => {
              e.preventDefault();
              selectCommit(commit.hash);
              setMenu({ x: e.clientX, y: e.clientY, hash: commit.hash });
            }}
          >
            <div className="graph-body" style={{ paddingLeft: graphWidth }}>
              <input
                type="checkbox"
                className="graph-check"
                title={t("Select for batch actions")}
                checked={checked.has(commit.hash)}
                aria-label={`Select commit ${shortHash(commit.hash)} for batch actions`}
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggleChecked(commit.hash)}
              />
              {ciBySha[commit.hash] && ciBySha[commit.hash] !== 'none' && (
                <span
                  className={`ci-dot ci-${ciBySha[commit.hash]}`}
                  title={t(`CI ${ciBySha[commit.hash]}`)}
                  aria-label={t(`CI ${ciBySha[commit.hash]}`)}
                />
              )}
              <RefBadges hash={commit.hash} />
              <span className="graph-subject">{commit.subject}</span>
              <span className="graph-author">{commit.authorName}</span>
              <span className="graph-hash">{shortHash(commit.hash)}</span>
              <span className="graph-time">{formatRelative(commit.date)}</span>
            </div>
          </div>
          );
        })}
      </div>

      {visibleCommits.length === 0 && (
        <div className="graph-no-match">{tp("No commits match “{query}”.", { query: search })}</div>
      )}

      {checked.size > 0 && (
        <div className="batch-bar" role="group" aria-label={t("Batch actions for selected commits")}>
          <span className="batch-count">{t(`${checked.size} selected`)}</span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={checked.size < 2}
            title={checked.size < 2 ? t('Select at least two commits') : t('Revert all selected commits')}
            onClick={handleBatchRevert}
          >
            <IconRevert width={14} height={14} /> {t("Revert")}
          </button>
          <button type="button" className="btn" onClick={handleBatchCopy}>
            <IconCopy width={14} height={14} /> {t("Copy SHAs")}
          </button>
          <button
            type="button"
            className="icon-btn"
            title={t("Clear selection")}
            onClick={() => setChecked(new Set())}
          >
            <IconX width={14} height={14} />
          </button>
        </div>
      )}

      {canLoadMore && (
        <button type="button" className="load-more" disabled={repoLoading} onClick={() => loadMore()}>
          {repoLoading ? 'Loading…' : 'Load more commits'}
        </button>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          title={shortHash(menu.hash)}
          items={menuItems}
          onSelect={onMenuSelect}
          onClose={() => setMenu(null)}
        />
      )}

      {branchFrom && currentRepo && (
        <NewBranchModal
          repo={currentRepo}
          fromRef={branchFrom}
          onClose={() => setBranchFrom(null)}
        />
      )}
      {tagFrom && currentRepo && (
        <TagModal
          repo={currentRepo}
          fromRef={tagFrom}
          onClose={() => setTagFrom(null)}
        />
      )}
      {revertMerge && (
        <RevertMergeModal
          hash={revertMerge.hash}
          parentCount={revertMerge.parentCount}
          onClose={() => setRevertMerge(null)}
        />
      )}
      {rebaseBase && <RebaseModal base={rebaseBase} onClose={() => setRebaseBase(null)} />}
      {filterModal && <LogFilterModal onClose={() => setFilterModal(false)} />}
    </div>
  );
}
