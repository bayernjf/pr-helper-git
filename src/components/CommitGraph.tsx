import { useMemo } from 'react';
import { useApp } from '../app-state';
import { layoutGraph } from '../lib/graph-layout';
import { formatRelative, shortHash } from '../lib/format';
import type { Ref } from '../types';

const ROW_H = 32;
const COL_W = 22;
const PAD_X = 12;

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
  const bend = Math.max(10, (y1 - y0) * 0.45);
  return `M ${x0} ${y0} C ${x0} ${y0 + bend}, ${x1} ${y1 - bend}, ${x1} ${y1}`;
}

function RefBadges({ hash }: { hash: string }) {
  const { refs, status } = useApp();
  const matching = useMemo(() => refs.filter((r) => r.hash === hash), [refs, hash]);
  const currentBranch = status?.branch;
  const headRef = refs.find((r) => r.name === `refs/heads/${currentBranch}`);

  const classify = (ref: Ref): string => {
    if (ref.name.startsWith('refs/heads/')) return 'branch';
    if (ref.name.startsWith('refs/remotes/')) return 'remote';
    if (ref.name.startsWith('refs/tags/')) return 'tag';
    return 'branch';
  };

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

export default function CommitGraph() {
  const { commits, selectedHash, selectCommit } = useApp();
  const layout = useMemo(() => layoutGraph(commits), [commits]);
  const graphWidth = Math.max(80, layout.lanes * COL_W + PAD_X * 2);

  return (
    <section className="commit-graph-pane">
      {layout.commits.map((commit, row) => {
        const x = PAD_X + commit.lane * COL_W;
        const y = ROW_H / 2;
        return (
          <div
            key={commit.hash}
            className={`graph-row${selectedHash === commit.hash ? ' selected' : ''}`}
            style={{ '--graph-width': `${graphWidth}px` } as React.CSSProperties}
            onClick={() => selectCommit(commit.hash)}
          >
            <div className="graph-canvas-cell">
              <svg
                width={graphWidth}
                height={ROW_H}
                style={{ overflow: 'visible' }}
              >
                {commit.parents.map((parent) => {
                  const parentRow = layout.rowOf.get(parent);
                  const parentLane = layout.laneOf.get(parent);
                  if (parentRow === undefined || parentLane === undefined) return null;
                  const px = PAD_X + parentLane * COL_W;
                  const py = ROW_H / 2 + (parentRow - row) * ROW_H;
                  return (
                    <path
                      key={parent}
                      d={edgePath(x, y, px, py)}
                      fill="none"
                      stroke={laneColor(commit.lane)}
                      strokeWidth={2}
                    />
                  );
                })}
                <circle
                  cx={x}
                  cy={y}
                  r={5}
                  fill={laneColor(commit.lane)}
                  stroke="#1b1b21"
                  strokeWidth={1.5}
                />
              </svg>
            </div>
            <div className="graph-meta">
              <RefBadges hash={commit.hash} />
              <span className="graph-subject">{commit.subject}</span>
              <span className="graph-author">{commit.authorName}</span>
              <span className="graph-hash">{shortHash(commit.hash)}</span>
              <span className="graph-date">{formatRelative(commit.date)}</span>
            </div>
          </div>
        );
      })}
    </section>
  );
}
