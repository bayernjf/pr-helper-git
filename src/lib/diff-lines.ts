export type DiffLineKind = 'meta' | 'hunk' | 'ctx' | 'add' | 'del';

export interface WordSegment {
  text: string;
  changed: boolean;
}

export interface ParsedDiffLine {
  kind: DiffLineKind;
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

// A row of the side-by-side view: headers span both columns, while a pair
// carries the old-side and new-side line for one visual row. Either side may
// be null when a change has no counterpart (pure insertion or deletion).
export type SplitRow =
  | { kind: 'header'; row: ParsedDiffLine }
  | { kind: 'pair'; left: ParsedDiffLine | null; right: ParsedDiffLine | null };

// Tokenise into words, whitespace runs and single punctuation characters, so
// an intra-line diff can highlight just the words that changed instead of the
// whole line.
function tokenize(text: string): string[] {
  return text.match(/\s+|[\p{L}\p{N}_]+|[\p{Extended_Pictographic}]|./gu) ?? [];
}

function pushSegment(list: WordSegment[], text: string, changed: boolean) {
  if (!text) return;
  const last = list[list.length - 1];
  if (last && last.changed === changed) last.text += text;
  else list.push({ text, changed });
}

// Word-level diff between a removed line and the added line that replaced it.
// Common prefixes/suffixes are trimmed first; the middle is aligned with an
// LCS table (bounded, falling back to "whole line changed" for huge lines).
export function wordDiff(
  oldText: string,
  newText: string,
): { left: WordSegment[]; right: WordSegment[] } {
  const left: WordSegment[] = [];
  const right: WordSegment[] = [];
  const a = tokenize(oldText);
  const b = tokenize(newText);

  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < a.length - prefix
    && suffix < b.length - prefix
    && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) suffix += 1;

  for (let i = 0; i < prefix; i += 1) {
    pushSegment(left, a[i], false);
    pushSegment(right, b[i], false);
  }

  const midA = a.slice(prefix, a.length - suffix);
  const midB = b.slice(prefix, b.length - suffix);
  // Guard against pathological single-line files.
  if (midA.length > 400 || midB.length > 400) {
    for (const token of midA) pushSegment(left, token, true);
    for (const token of midB) pushSegment(right, token, true);
  } else {
    const n = midA.length;
    const m = midB.length;
    const dp: number[][] = new Array(n + 1);
    for (let i = 0; i <= n; i += 1) dp[i] = new Array(m + 1).fill(0);
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        dp[i][j] = midA[i] === midB[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        pushSegment(left, midA[i], false);
        pushSegment(right, midB[j], false);
        i += 1;
        j += 1;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        pushSegment(left, midA[i], true);
        i += 1;
      } else {
        pushSegment(right, midB[j], true);
        j += 1;
      }
    }
    while (i < n) { pushSegment(left, midA[i], true); i += 1; }
    while (j < m) { pushSegment(right, midB[j], true); j += 1; }
  }

  for (let i = a.length - suffix; i < a.length; i += 1) {
    pushSegment(left, a[i], false);
  }
  for (let i = b.length - suffix; i < b.length; i += 1) {
    pushSegment(right, b[i], false);
  }
  return { left, right };
}

// Pair removed and added lines inside each contiguous change block, so a split
// view shows the old and new version of a line on the same row instead of
// laying deletions out above insertions. Context lines pair with themselves;
// file/hunk headers stay full-width.
export function pairDiffRows(rows: ParsedDiffLine[]): SplitRow[] {
  const out: SplitRow[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (row.kind === 'meta' || row.kind === 'hunk') {
      out.push({ kind: 'header', row });
      i += 1;
      continue;
    }
    if (row.kind === 'ctx') {
      out.push({ kind: 'pair', left: row, right: row });
      i += 1;
      continue;
    }
    // Collect the whole change block first: deletions and insertions that
    // belong together are adjacent in unified output.
    const dels: ParsedDiffLine[] = [];
    const adds: ParsedDiffLine[] = [];
    while (i < rows.length && (rows[i].kind === 'del' || rows[i].kind === 'add')) {
      (rows[i].kind === 'del' ? dels : adds).push(rows[i]);
      i += 1;
    }
    const count = Math.max(dels.length, adds.length);
    for (let k = 0; k < count; k += 1) {
      out.push({ kind: 'pair', left: dels[k] ?? null, right: adds[k] ?? null });
    }
  }
  return out;
}

// Intra-line segments for the unified view, keyed by the row's index in the
// parsed array. Removed and added lines are paired inside each change block so
// only the words that differ are highlighted, matching the split view.
export function wordSegmentsByRow(rows: ParsedDiffLine[]): Map<number, WordSegment[]> {
  const out = new Map<number, WordSegment[]>();
  let i = 0;
  while (i < rows.length) {
    if (rows[i].kind !== 'del' && rows[i].kind !== 'add') {
      i += 1;
      continue;
    }
    const delIdx: number[] = [];
    const addIdx: number[] = [];
    while (i < rows.length && (rows[i].kind === 'del' || rows[i].kind === 'add')) {
      (rows[i].kind === 'del' ? delIdx : addIdx).push(i);
      i += 1;
    }
    const count = Math.min(delIdx.length, addIdx.length);
    for (let k = 0; k < count; k += 1) {
      const li = delIdx[k];
      const ri = addIdx[k];
      if (rows[li].text === rows[ri].text) continue;
      const diff = wordDiff(rows[li].text, rows[ri].text);
      if (!diff.left.some((s) => s.changed) && !diff.right.some((s) => s.changed)) continue;
      out.set(li, diff.left);
      out.set(ri, diff.right);
    }
  }
  return out;
}

// Parse a unified diff into rows with old/new line numbers derived from the
// hunk headers (`@@ -a,b +c,d @@`).
export function parseDiffLines(diff: string): ParsedDiffLine[] {
  const rows: ParsedDiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;

  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git')) {
      // A new file header ends the previous file's hunk section.
      inHunk = false;
    }
    if (raw.startsWith('@@')) {
      const m = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      oldNo = m ? Number(m[1]) : 0;
      newNo = m ? Number(m[2]) : 0;
      inHunk = true;
      rows.push({ kind: 'hunk', text: raw, oldNo: null, newNo: null });
      continue;
    }
    // Header lines only appear before the first hunk. Inside a hunk a removed
    // or added line can itself start with "--"/"++" (e.g. deleting a SQL or
    // Markdown separator), so those must stay content rows.
    if (!inHunk && (raw.startsWith('diff --git') || raw.startsWith('index ')
      || raw.startsWith('---') || raw.startsWith('+++')
      || raw.startsWith('new file') || raw.startsWith('deleted file')
      || raw.startsWith('rename ') || raw.startsWith('similarity ')
      || raw.startsWith('Binary'))) {
      rows.push({ kind: 'meta', text: raw, oldNo: null, newNo: null });
      continue;
    }
    // "\ No newline at end of file" marks a missing trailing newline; it is
    // not a content line and must not advance the counters.
    if (raw.startsWith('\\ No newline at end of file')) {
      rows.push({ kind: 'meta', text: raw, oldNo: null, newNo: null });
      continue;
    }
    if (raw.startsWith('+')) {
      rows.push({ kind: 'add', text: raw.slice(1), oldNo: null, newNo });
      newNo += 1;
    } else if (raw.startsWith('-')) {
      rows.push({ kind: 'del', text: raw.slice(1), oldNo, newNo: null });
      oldNo += 1;
    } else {
      const text = raw.startsWith(' ') ? raw.slice(1) : raw;
      rows.push({ kind: 'ctx', text, oldNo, newNo });
      oldNo += 1;
      newNo += 1;
    }
  }
  return rows;
}
