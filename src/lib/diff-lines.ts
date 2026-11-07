export type DiffLineKind = 'meta' | 'hunk' | 'ctx' | 'add' | 'del';

export interface ParsedDiffLine {
  kind: DiffLineKind;
  text: string;
  oldNo: number | null;
  newNo: number | null;
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
