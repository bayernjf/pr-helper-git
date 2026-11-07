// Windowed rendering range for a long, fixed-height list. `scrollTop` and
// `viewportHeight` are measured inside the list's own coordinate space (i.e.
// relative to the top of the first row), so callers subtract any header offset
// before calling. `overscan` renders a few extra rows above and below the
// viewport to avoid blank bands while scrolling.
export interface RowRange {
  start: number;
  end: number;
}

export function windowRange(
  total: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan = 8,
): RowRange {
  if (total <= 0 || rowHeight <= 0) return { start: 0, end: 0 };
  const top = Math.max(0, scrollTop);
  const height = Math.max(0, viewportHeight);
  const start = Math.max(0, Math.floor(top / rowHeight) - overscan);
  const end = Math.min(total, Math.ceil((top + height) / rowHeight) + overscan);
  return { start, end: Math.max(start, end) };
}
