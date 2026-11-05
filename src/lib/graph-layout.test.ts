import { describe, expect, it } from 'vitest';
import type { Commit } from '../types';
import { layoutGraph } from './graph-layout';

function commit(hash: string, parents: string[]): Commit {
  return {
    hash,
    parents,
    authorName: 'tester',
    authorEmail: 'tester@example.com',
    date: '2026-11-01T00:00:00Z',
    subject: `subject ${hash}`,
    body: '',
  };
}

describe('layoutGraph', () => {
  it('places a linear history on a single lane', () => {
    const commits = [
      commit('c3', ['c2']),
      commit('c2', ['c1']),
      commit('c1', []),
    ];
    const layout = layoutGraph(commits);
    expect(layout.lanes).toBe(1);
    expect(layout.commits.map((c) => c.lane)).toEqual([0, 0, 0]);
    expect(layout.rowOf.get('c2')).toBe(1);
  });

  it('puts diverged branches on separate lanes', () => {
    const commits = [
      commit('A', ['root']),
      commit('B', ['root']),
      commit('root', []),
    ];
    const layout = layoutGraph(commits);
    expect(layout.lanes).toBe(2);
    expect(layout.laneOf.get('A')).toBe(0);
    expect(layout.laneOf.get('B')).toBe(1);
    expect(layout.laneOf.get('root')).toBe(0);
  });

  it('releases the extra lane when a merge joins two lanes', () => {
    const commits = [
      commit('M', ['A', 'B']),
      commit('A', ['root']),
      commit('B', ['root']),
      commit('root', []),
    ];
    const layout = layoutGraph(commits);
    expect(layout.laneOf.get('M')).toBe(0);
    expect(layout.laneOf.get('A')).toBe(0);
    expect(layout.laneOf.get('B')).toBe(1);
    expect(layout.laneOf.get('root')).toBe(0);
    // Every commit resolves to a known row and lane.
    for (const c of commits) {
      expect(layout.rowOf.has(c.hash)).toBe(true);
      expect(layout.laneOf.has(c.hash)).toBe(true);
    }
  });

  it('handles an empty input', () => {
    const layout = layoutGraph([]);
    expect(layout.lanes).toBe(0);
    expect(layout.commits).toEqual([]);
  });
});
