import { useMemo, useState } from 'react';
import { useApp } from '../app-state';
import { layoutGraph } from '../lib/graph-layout';
import { formatRelative, shortHash } from '../lib/format';
import type { Ref } from '../types';
import { ContextMenu, type MenuItem } from './context-menu';
import {
  IconBranch,
  IconCommit,
  IconCopy,
  IconTag,
} from './icons';
import NewBranchModal from './NewBranchModal';
import TagModal from './TagModal';

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
      {headRef?.hash === hash && <span className="ref-badge head">HEAD</span>}
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
  const { commits, selectedHash, selectCommit, currentRepo, toast } = useApp();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [branchFrom, setBranchFrom] = useState<string | null>(null);
  const [tagFrom, setTagFrom] = useState<string | null>(null);

  const layout = useMemo(() => layoutGraph(commits), [commits]);
  const lanes = layout.lanes;
  const graphWidth = Math.max(70, lanes * COL_W + PAD_X * 2);
  const totalHeight = commits.length * ROW_H;

  const edges = useMemo(() => {
    const out: Array<{ key: string; d: string; color: string }> = [];
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
        });
      }
    });
    return out;
  }, [layout]);

  const menuItems: MenuItem[] = [
    { id: 'copy', label: 'Copy full hash', icon: <IconCopy width={15} height={15} /> },
    { separator: true },
    { id: 'branch', label: 'Create branch here', icon: <IconBranch width={15} height={15} /> },
    { id: 'tag', label: 'Create tag here', icon: <IconTag width={15} height={15} /> },
  ];

  const onMenuSelect = (id: string) => {
    if (!menu) return;
    if (id === 'copy') {
      navigator.clipboard?.writeText(menu.hash).then(
        () => toast('Hash copied to clipboard', 'success'),
        () => toast('Copy failed', 'error'),
      );
    } else if (id === 'branch') {
      setBranchFrom(menu.hash);
    } else if (id === 'tag') {
      setTagFrom(menu.hash);
    }
    setMenu(null);
  };

  if (!commits.length) {
    return (
      <div className="graph-scroll">
        <div className="empty-state">
          <div className="empty-icon"><IconCommit width={28} height={28} /></div>
          <h3>No commits yet</h3>
          <p>Stage files below and create the first commit to see the graph.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="graph-scroll">
      <div className="graph" style={{ width: graphWidth, minWidth: '100%', height: totalHeight }}>
        <svg className="graph-svg" width={graphWidth} height={totalHeight}>
          {edges.map((e) => (
            <path key={e.key} d={e.d} fill="none" stroke={e.color} strokeWidth={2} />
          ))}
          {layout.commits.map((commit, row) => {
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

        {layout.commits.map((commit, row) => (
          <div
            key={commit.hash}
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
              <RefBadges hash={commit.hash} />
              <span className="graph-subject">{commit.subject}</span>
              <span className="graph-author">{commit.authorName}</span>
              <span className="graph-hash">{shortHash(commit.hash)}</span>
              <span className="graph-time">{formatRelative(commit.date)}</span>
            </div>
          </div>
        ))}
      </div>

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
    </div>
  );
}
