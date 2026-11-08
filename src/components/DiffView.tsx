import { useEffect, useMemo, useState } from 'react';
import { discardHunk, stageHunk, stageLines } from '../api';
import { useApp } from '../app-state';
import {
  parseDiffLines,
  pairDiffRows,
  wordDiff,
  wordSegmentsByRow,
  type ParsedDiffLine,
  type SplitRow,
  type WordSegment,
} from '../lib/diff-lines';
import type { DiffResult } from '../types';
import { IconSplit, IconUnified } from './icons';
import { t } from '../i18n';

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="diff-pane">
      <div className="diff-empty">{children}</div>
    </div>
  );
}

function Toggle({
  mode,
  setMode,
}: {
  mode: 'unified' | 'split';
  setMode: (m: 'unified' | 'split') => void;
}) {
  return (
    <span className="view-toggle">
      <button
        type="button"
        className={mode === 'unified' ? 'active' : ''}
        title={t("Unified view")}
        onClick={() => setMode('unified')}
      >
        <IconUnified width={14} height={14} />
      </button>
      <button
        type="button"
        className={mode === 'split' ? 'active' : ''}
        title={t("Split view")}
        onClick={() => setMode('split')}
      >
        <IconSplit width={14} height={14} />
      </button>
    </span>
  );
}

function UnifiedRow({
  row,
  segments,
  selectable = false,
  selected = false,
  onToggle,
}: {
  row: ParsedDiffLine;
  segments?: WordSegment[];
  selectable?: boolean;
  selected?: boolean;
  onToggle?: () => void;
}) {
  const sign = row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : row.kind === 'hunk' ? '' : ' ';
  return (
    <div
      className={`diff-line ${row.kind}${selectable ? ' selectable' : ''}${selected ? ' is-selected' : ''}`}
      onClick={selectable ? onToggle : undefined}
      title={selectable ? 'Select this line for line-level staging' : undefined}
    >
      <span className="diff-gutter">{row.oldNo ?? ''}</span>
      <span className="diff-gutter">{row.newNo ?? ''}</span>
      <span className="diff-sign">{sign}</span>
      <span className="diff-content">
        {segments
          ? segments.map((seg, i) => (seg.changed
            ? <span key={i} className={row.kind === 'del' ? 'word-del' : 'word-add'}>{seg.text}</span>
            : <span key={i}>{seg.text}</span>))
          : row.text || ' '}
      </span>
    </div>
  );
}

function SplitSide({
  row,
  side,
  segments,
}: {
  row: ParsedDiffLine | null;
  side: 'left' | 'right';
  segments?: WordSegment[] | null;
}) {
  if (!row) {
    return <div className={`diff-side empty ${side === 'right' ? 'right' : ''}`} />;
  }
  const no = side === 'left' ? row.oldNo : row.newNo;
  const kind = side === 'left'
    ? row.kind === 'add' ? 'ctx' : row.kind
    : row.kind === 'del' ? 'ctx' : row.kind;
  const sign = side === 'left' ? (row.kind === 'del' ? '-' : ' ') : (row.kind === 'add' ? '+' : ' ');
  return (
    <div className={`diff-side ${kind}${side === 'right' ? ' right' : ''}`}>
      <span className="diff-gutter">{no ?? ''}</span>
      <span className="diff-sign">{sign}</span>
      <span className="diff-content">
        {segments
          ? segments.map((seg, i) => (seg.changed
            ? <span key={i} className={side === 'left' ? 'word-del' : 'word-add'}>{seg.text}</span>
            : <span key={i}>{seg.text}</span>))
          : row.text || ' '}
      </span>
    </div>
  );
}

function SplitRowView({ row }: { row: SplitRow }) {
  if (row.kind === 'header') {
    return (
      <div className={`diff-line ${row.row.kind}`}>
        <span className="diff-content">{row.row.text}</span>
      </div>
    );
  }
  // Highlight only the words that actually differ between the paired removed
  // and added line; context rows and one-sided changes stay unhighlighted.
  let leftSeg: WordSegment[] | null = null;
  let rightSeg: WordSegment[] | null = null;
  if (row.left?.kind === 'del' && row.right?.kind === 'add'
    && row.left.text !== row.right.text) {
    const diff = wordDiff(row.left.text, row.right.text);
    if (diff.left.some((s) => s.changed) || diff.right.some((s) => s.changed)) {
      leftSeg = diff.left;
      rightSeg = diff.right;
    }
  }
  return (
    <div className="diff-split-row">
      <SplitSide row={row.left} side="left" segments={leftSeg} />
      <SplitSide row={row.right} side="right" segments={rightSeg} />
    </div>
  );
}

export default function DiffView({
  result,
  repo,
  staged = false,
}: {
  result: DiffResult | null;
  repo?: string;
  staged?: boolean;
}) {
  const { runAction } = useApp();
  const [mode, setMode] = useState<'unified' | 'split'>('unified');
  const [pending, setPending] = useState<{ index: number; kind: string } | null>(null);
  // hunk index -> selected body line indexes (0 is the first line after @@).
  const [selection, setSelection] = useState<Record<number, number[]>>({});
  const rows = useMemo(() => (result?.diff ? parseDiffLines(result.diff) : []), [result]);
  const splitRows = useMemo(() => pairDiffRows(rows), [rows]);

  // A different file or a refreshed diff invalidates the hunk indexes, so drop
  // the line selection instead of mis-targeting the next write.
  const diffKey = result?.path ? `${result.path}:${result.diff}` : '';
  useEffect(() => {
    setSelection({});
  }, [diffKey]);
  const unifiedSegments = useMemo(() => wordSegmentsByRow(rows), [rows]);

  // Hunk actions are only available in the unified view for tracked changes
  // (untracked files have no ordinary git diff and keep whole-file staging).
  const hunkActionsEnabled = mode === 'unified' && !!repo && !!result && !result.untracked;

  async function applyHunk(hunkIndex: number) {
    if (!repo || !result || pending !== null) return;
    const action = staged ? 'unstage' : 'stage';
    setPending({ index: hunkIndex, kind: action });
    // runAction refreshes status and all data after the write, so the diff
    // pane reloads to reflect the new index/working-tree split.
    await runAction(
      stageHunk(repo, result.path, hunkIndex, action),
      `${action === 'unstage' ? 'Unstaged' : 'Staged'} hunk`,
    );
    setPending(null);
  }

  function toggleLine(hunkIndex: number, bodyIndex: number) {
    setSelection((prev) => {
      const current = prev[hunkIndex] ?? [];
      const next = current.includes(bodyIndex)
        ? current.filter((n) => n !== bodyIndex)
        : [...current, bodyIndex];
      const copy = { ...prev };
      if (next.length) copy[hunkIndex] = next;
      else delete copy[hunkIndex];
      return copy;
    });
  }

  async function applyLines(hunkIndex: number) {
    if (!repo || !result || pending !== null) return;
    const lines = selection[hunkIndex] ?? [];
    if (!lines.length) return;
    const action = staged ? 'unstage' : 'stage';
    setPending({ index: hunkIndex, kind: 'lines' });
    // runAction refreshes status and all data after the write, so the diff
    // pane reloads to reflect the new index/working-tree split.
    await runAction(
      stageLines(repo, result.path, hunkIndex, lines, action),
      `${action === 'unstage' ? 'Unstaged' : 'Staged'} ${lines.length} line${lines.length === 1 ? '' : 's'}`,
    );
    setPending(null);
    setSelection((prev) => {
      const copy = { ...prev };
      delete copy[hunkIndex];
      return copy;
    });
  }

  async function discardSelectedHunk(hunkIndex: number) {
    if (!repo || !result || pending !== null) return;
    setPending({ index: hunkIndex, kind: 'discard' });
    await runAction(discardHunk(repo, result.path, hunkIndex), 'Discarded hunk');
    setPending(null);
  }

  if (!result) return <EmptyHint>{t("Select a file to review its changes.")}</EmptyHint>;
  if (result.masked) {
    return <EmptyHint>{result.path} is sensitive — its contents are masked.</EmptyHint>;
  }
  if (!result.diff) {
    return <EmptyHint>{t("No diff available for this file.")}</EmptyHint>;
  }

  // Assign sequential hunk indices while walking the parsed rows, and number
  // the body lines inside each hunk (0 is the first line after the @@ header).
  let hunkCounter = -1;
  let bodyIndex = 0;

  return (
    <div className="diff-pane">
      <div className="diff-toolbar">
        <span className="file-name">{result.path}</span>
        <Toggle mode={mode} setMode={setMode} />
      </div>
      {mode === 'unified' ? (
        <pre className="diff">
          {rows.map((row, i) => {
            if (row.kind === 'hunk') {
              hunkCounter += 1;
              bodyIndex = 0;
              const hunkIndex = hunkCounter;
              const selectedCount = selection[hunkIndex]?.length ?? 0;
              return (
                <div className="diff-line hunk" key={i}>
                  <span className="hunk-header-text">{row.text}</span>
                  {hunkActionsEnabled && (
                    <>
                      <button
                        type="button"
                        className="hunk-btn"
                        disabled={pending !== null}
                        title={staged ? 'Unstage this hunk' : 'Stage this hunk'}
                        onClick={() => applyHunk(hunkIndex)}
                      >
                        {pending?.index === hunkIndex && pending.kind !== 'discard'
                          ? '…'
                          : staged ? 'Unstage hunk' : 'Stage hunk'}
                      </button>
                      {selectedCount > 0 && (
                        <>
                          <button
                            type="button"
                            className="hunk-btn hunk-btn-primary"
                            disabled={pending !== null}
                            title={`${staged ? 'Unstage' : 'Stage'} only the selected lines`}
                            onClick={() => applyLines(hunkIndex)}
                          >
                            {pending?.index === hunkIndex && pending.kind === 'lines'
                              ? '…'
                              : `${staged ? 'Unstage' : 'Stage'} ${selectedCount} line${selectedCount === 1 ? '' : 's'}`}
                          </button>
                          <button
                            type="button"
                            className="hunk-btn"
                            disabled={pending !== null}
                            title={t("Clear the line selection")}
                            onClick={() => setSelection((prev) => {
                              const copy = { ...prev };
                              delete copy[hunkIndex];
                              return copy;
                            })}
                          >
                            Clear
                          </button>
                        </>
                      )}
                      {!staged && (
                        <button
                          type="button"
                          className="hunk-btn hunk-btn-danger"
                          disabled={pending !== null}
                          title={t("Discard this hunk (restore the working tree)")}
                          onClick={() => discardSelectedHunk(hunkIndex)}
                        >
                          {pending?.index === hunkIndex && pending.kind === 'discard'
                            ? '…'
                            : 'Discard hunk'}
                        </button>
                      )}
                    </>
                  )}
                </div>
              );
            }
            const index = bodyIndex;
            bodyIndex += 1;
            const changed = row.kind === 'add' || row.kind === 'del';
            return (
              <UnifiedRow
                key={i}
                row={row}
                segments={unifiedSegments.get(i)}
                selectable={hunkActionsEnabled && changed}
                selected={(selection[hunkCounter] ?? []).includes(index)}
                onToggle={() => toggleLine(hunkCounter, index)}
              />
            );
          })}
        </pre>
      ) : (
        <pre className="diff">
          {splitRows.map((row, i) => (
            <SplitRowView key={i} row={row} />
          ))}
        </pre>
      )}
      {result.truncated && <div className="diff-empty">{t("Diff truncated at 2000 lines.")}</div>}
    </div>
  );
}
