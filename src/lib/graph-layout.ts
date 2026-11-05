// Lane assignment for the commit graph. Input is the new-to-old commit list
// produced by `git log --all --date-order`; output assigns every commit a
// stable column (lane) and returns lookup maps for rendering.
import type { Commit } from '../types';

export interface LayoutCommit extends Commit {
  lane: number;
}

export interface GraphLayout {
  lanes: number;
  commits: LayoutCommit[];
  laneOf: Map<string, number>;
  rowOf: Map<string, number>;
}

export function layoutGraph(commits: Commit[]): GraphLayout {
  // laneHead maps an active lane to the commit hash it is waiting for.
  const laneHead: Array<string | null> = [];
  const hashLane = new Map<string, number>();
  const result: LayoutCommit[] = [];

  const freeLane = (): number => {
    const idx = laneHead.findIndex((h) => h === null);
    if (idx !== -1) return idx;
    laneHead.push(null);
    return laneHead.length - 1;
  };

  for (const commit of commits) {
    let lane = hashLane.get(commit.hash);
    if (lane === undefined) {
      lane = freeLane();
    }
    // A merge can arrive on several lanes at once; release the extra ones.
    for (let i = 0; i < laneHead.length; i += 1) {
      if (i !== lane && laneHead[i] === commit.hash) {
        laneHead[i] = null;
        hashLane.delete(commit.hash);
      }
    }

    result.push({ ...commit, lane });

    const parents = commit.parents;
    if (parents.length === 0) {
      laneHead[lane] = null;
      hashLane.delete(commit.hash);
    } else {
      // The first parent continues on this lane only when it is not already
      // tracked elsewhere; otherwise this lane closes into that existing one.
      if (!hashLane.has(parents[0])) {
        laneHead[lane] = parents[0];
        hashLane.set(parents[0], lane);
      } else {
        laneHead[lane] = null;
      }
      // Additional merge parents take free lanes when not already tracked.
      for (let p = 1; p < parents.length; p += 1) {
        const parent = parents[p];
        if (!hashLane.has(parent)) {
          const newLane = freeLane();
          laneHead[newLane] = parent;
          hashLane.set(parent, newLane);
        }
      }
    }

    // Keep the lane array compact by trimming trailing free lanes.
    while (laneHead.length > 0 && laneHead[laneHead.length - 1] === null) {
      laneHead.pop();
    }
  }

  const laneOf = new Map<string, number>();
  const rowOf = new Map<string, number>();
  result.forEach((c, row) => {
    laneOf.set(c.hash, c.lane);
    rowOf.set(c.hash, row);
  });

  const maxLane = result.reduce((m, c) => Math.max(m, c.lane), -1);
  return { lanes: maxLane + 1, commits: result, laneOf, rowOf };
}
