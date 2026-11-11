// Line-level staging math: parse a hunk and rebuild a valid mini-patch from a
// subset of its +/- lines, recomputing the @@ header counts. Ported from the
// first-generation client (`src/lib/diff/lines.ts`) so both products stage
// partial lines the same way.
//
// The rebuild keeps every context line (git needs the surrounding context to
// locate the hunk) and drops unselected changes. A hunk whose old or new side
// ends up empty switches to git's "after line N" form, which is why the start
// numbers are adjusted rather than copied.

export const MAX_SELECTED_LINES = 5000;

/**
 * @param {string[]} hunkLines the hunk exactly as split out of the diff, header first
 * @returns {null | {header: string, startOld: number, countOld: number,
 *   startNew: number, countNew: number, lines: {kind: 'ctx'|'add'|'del',
 *   index: number, oldLn: number|null, newLn: number|null, text: string}[]}}
 */
export function parseHunk(hunkLines) {
  const all = [...hunkLines];
  while (all.length > 0 && all[all.length - 1] === '') all.pop();
  const header = all[0] || '';
  const match = header.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
  if (!match) return null;
  const startOld = Number(match[1]);
  const countOld = match[2] === undefined ? 1 : Number(match[2]);
  const startNew = Number(match[3]);
  const countNew = match[4] === undefined ? 1 : Number(match[4]);
  let oldLn = startOld;
  let newLn = startNew;
  /** @type {{kind: 'ctx'|'add'|'del', index: number, oldLn: number|null, newLn: number|null, text: string}[]} */
  const lines = [];
  let index = 0;
  for (const line of all.slice(1)) {
    /** @type {'ctx'|'add'|'del'} */
    const kind = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'ctx';
    if (line.startsWith('\\')) {
      // "\ No newline at end of file" — a meta marker without line numbers.
      lines.push({ kind: 'ctx', index, oldLn: null, newLn: null, text: line });
    } else if (kind === 'ctx') {
      lines.push({ kind, index, oldLn: oldLn++, newLn: newLn++, text: line.slice(1) });
    } else if (kind === 'add') {
      lines.push({ kind, index, oldLn: null, newLn: newLn++, text: line.slice(1) });
    } else {
      lines.push({ kind, index, oldLn: oldLn++, newLn: null, text: line.slice(1) });
    }
    index += 1;
  }
  return { header, startOld, countOld, startNew, countNew, lines };
}

/**
 * Rebuild a single-hunk patch keeping all context lines but only the selected
 * +/- body lines. `selected` holds body line indexes (as returned by parseHunk).
 * Returns null when no +/- line is selected.
 *
 * `action` decides which side of the patch is applied:
 *   - 'stage' applies the patch forward to the index, so the index already
 *     holds every removed line: an unselected removal is kept as context, while
 *     an unselected addition is dropped (it only exists in the working tree).
 *   - 'unstage' applies the patch in reverse to the index, so the index already
 *     holds every added line: an unselected addition is kept as context, while
 *     an unselected removal is dropped.
 * Dropping the wrong one is what makes a naive rebuild fail with "patch does
 * not apply" whenever selected and unselected changes share a hunk.
 *
 * @param {string[]} headerLines the file header ("diff --git …", "--- ", "+++ ")
 * @param {string[]} hunkLines the full hunk, header first
 * @param {number[]} selected
 * @param {'stage'|'unstage'} action
 */
export function buildLineSelectionPatch(headerLines, hunkLines, selected, action = 'stage') {
  const parsed = parseHunk(hunkLines);
  if (!parsed) return null;
  const chosen = new Set(selected);
  const presentIsOld = action !== 'unstage';

  const kept = [];
  for (const line of parsed.lines) {
    if (line.text.startsWith('\\')) {
      kept.push(line); // markers are pruned below
    } else if (line.kind === 'ctx' || chosen.has(line.index)) {
      kept.push(line);
    } else if (presentIsOld ? line.kind === 'del' : line.kind === 'add') {
      // Unselected change that the target side already contains: keep it as
      // context so the pre/post image still matches the index.
      kept.push({ ...line, kind: 'ctx' });
    }
    // Otherwise the unselected change exists only on the other side: drop it.
  }

  // A "\ No newline" marker is only valid right after its own change line: drop
  // markers whose preceding kept line became context (i.e. unselected).
  const pruned = kept.filter((line, i) => {
    if (!line.text.startsWith('\\')) return true;
    const prev = kept[i - 1];
    return Boolean(prev && prev.kind !== 'ctx');
  });
  const hasSelection = pruned.some((line) => line.kind !== 'ctx' && !line.text.startsWith('\\'));
  if (!hasSelection) return null;

  let oldCount = 0;
  let newCount = 0;
  let firstOld = null;
  let firstNew = null;
  for (const line of pruned) {
    if (line.text.startsWith('\\')) continue;
    if (line.kind === 'ctx') {
      oldCount += 1;
      newCount += 1;
      if (firstOld === null) firstOld = line.oldLn;
      if (firstNew === null) firstNew = line.newLn;
    } else if (line.kind === 'del') {
      oldCount += 1;
      if (firstOld === null) firstOld = line.oldLn;
    } else {
      newCount += 1;
      if (firstNew === null) firstNew = line.newLn;
    }
  }
  // A zero count means "after line N". When the original count was already 0
  // its start already uses that semantics and must be preserved; otherwise the
  // start shrinks by one when its side empties out.
  const zeroStart = (originalStart, originalCount) =>
    originalCount === 0 ? originalStart : Math.max(0, originalStart - 1);
  const oldStart = oldCount === 0
    ? zeroStart(parsed.startOld, parsed.countOld)
    : (firstOld ?? parsed.startOld);
  const newStart = newCount === 0
    ? zeroStart(parsed.startNew, parsed.countNew)
    : (firstNew ?? parsed.startNew);

  const out = [headerLines.join('\n'), `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`];
  for (const line of pruned) {
    if (line.text.startsWith('\\')) out.push(line.text);
    else out.push((line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' ') + line.text);
  }
  // git apply requires the patch text to end with a newline.
  return `${out.join('\n')}\n`;
}
