// Keyboard navigation math for the commit graph, kept pure so it can be tested
// without mounting React. The component owns the DOM side (focus, scrolling,
// aria-activedescendant); this file only decides which commit comes next.

export type GraphNavKey =
  | 'ArrowDown'
  | 'ArrowUp'
  | 'Home'
  | 'End'
  | 'PageDown'
  | 'PageUp'
  | 'Escape';

export const GRAPH_NAV_KEYS: GraphNavKey[] = [
  'ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp', 'Escape',
];

export function isGraphNavKey(key: string): key is GraphNavKey {
  return (GRAPH_NAV_KEYS as string[]).includes(key);
}

/**
 * Next selected index, or null when the key clears the selection (Escape).
 *
 * `current` is -1 when nothing is selected (or the selected commit fell out of
 * the filtered list). A downward move from "nothing selected" lands on the
 * first row, an upward move on the last one — the same convention as the older
 * vanilla client.
 */
export function nextCommitIndex(
  key: GraphNavKey,
  current: number,
  count: number,
  pageSize: number,
): number | null {
  if (count <= 0) return null;
  if (key === 'Escape') return null;

  const page = Math.max(1, pageSize);
  const lastIndex = count - 1;
  let next: number;

  switch (key) {
    case 'Home': next = 0; break;
    case 'End': next = lastIndex; break;
    case 'PageDown': next = current < 0 ? 0 : current + page; break;
    case 'PageUp': next = current < 0 ? 0 : current - page; break;
    case 'ArrowDown': next = current < 0 ? 0 : current + 1; break;
    case 'ArrowUp': next = current < 0 ? lastIndex : current - 1; break;
    default: next = current;
  }

  return Math.min(lastIndex, Math.max(0, next));
}

/** How many rows fit in one "page", leaving one row of overlap context. */
export function pageSizeForViewport(viewportHeight: number, rowHeight: number): number {
  if (rowHeight <= 0) return 1;
  return Math.max(1, Math.floor(viewportHeight / rowHeight) - 1);
}
