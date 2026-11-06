import { useMemo, useState } from 'react';
import { stageHunk } from '../api';
import { useApp } from '../app-state';
import { parseDiffLines, type ParsedDiffLine } from '../lib/diff-lines';
import type { DiffResult } from '../types';
import { IconSplit, IconUnified } from './icons';

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
        title="Unified view"
        onClick={() => setMode('unified')}
      >
        <IconUnified width={14} height={14} />
      </button>
      <button
        type="button"
        className={mode === 'split' ? 'active' : ''}
        title="Split view"
        onClick={() => setMode('split')}
      >
        <IconSplit width={14} height={14} />
      </button>
    </span>
  );
}

function UnifiedRow({ row }: { row: ParsedDiffLine }) {
  const sign = row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : row.kind === 'hunk' ? '' : ' ';
  return (
    <div className={`diff-line ${row.kind}`}>
      <span className="diff-gutter">{row.oldNo ?? ''}</span>
      <span className="diff-gutter">{row.newNo ?? ''}</span>
      <span className="diff-sign">{sign}</span>
      <span className="diff-content">{row.text || ' '}</span>
    </div>
  );
}

function SplitRow({ row }: { row: ParsedDiffLine }) {
  const leftNo = row.kind === 'add' ? null : row.oldNo;
  const rightNo = row.kind === 'del' ? null : row.newNo;
  const leftText = row.kind === 'add' ? '' : row.text;
  const rightText = row.kind === 'del' ? '' : row.text;
  const leftKind = row.kind === 'add' ? 'ctx' : row.kind;
  const rightKind = row.kind === 'del' ? 'ctx' : row.kind;

  return (
    <div className="diff-split-row">
      <div className={`diff-side ${leftKind}`}>
        <span className="diff-gutter">{leftNo ?? ''}</span>
        <span className="diff-sign">{row.kind === 'del' ? '-' : ' '}</span>
        <span className="diff-content">{leftText || ' '}</span>
      </div>
      <div className={`diff-side right ${rightKind}`}>
        <span className="diff-gutter">{rightNo ?? ''}</span>
        <span className="diff-sign">{row.kind === 'add' ? '+' : ' '}</span>
        <span className="diff-content">{rightText || ' '}</span>
      </div>
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
  const [pendingHunk, setPendingHunk] = useState<number | null>(null);
  const rows = useMemo(() => (result?.diff ? parseDiffLines(result.diff) : []), [result]);

  // Hunk actions are only available in the unified view for tracked changes
  // (untracked files have no ordinary git diff and keep whole-file staging).
  const hunkActionsEnabled = mode === 'unified' && !!repo && !!result && !result.untracked;

  async function applyHunk(hunkIndex: number) {
    if (!repo || !result || pendingHunk !== null) return;
    const action = staged ? 'unstage' : 'stage';
    setPendingHunk(hunkIndex);
    // runAction refreshes status and all data after the write, so the diff
    // pane reloads to reflect the new index/working-tree split.
    await runAction(
      stageHunk(repo, result.path, hunkIndex, action),
      `${action === 'unstage' ? 'Unstaged' : 'Staged'} hunk`,
    );
    setPendingHunk(null);
  }

  if (!result) return <EmptyHint>Select a file to review its changes.</EmptyHint>;
  if (result.masked) {
    return <EmptyHint>{result.path} is sensitive — its contents are masked.</EmptyHint>;
  }
  if (!result.diff) {
    return <EmptyHint>No diff available for this file.</EmptyHint>;
  }

  // Assign sequential hunk indices while walking the parsed rows.
  let hunkCounter = -1;

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
              const hunkIndex = hunkCounter;
              return (
                <div className="diff-line hunk" key={i}>
                  <span className="hunk-header-text">{row.text}</span>
                  {hunkActionsEnabled && (
                    <button
                      type="button"
                      className="hunk-btn"
                      disabled={pendingHunk !== null}
                      title={staged ? 'Unstage this hunk' : 'Stage this hunk'}
                      onClick={() => applyHunk(hunkIndex)}
                    >
                      {pendingHunk === hunkIndex
                        ? '…'
                        : staged ? 'Unstage hunk' : 'Stage hunk'}
                    </button>
                  )}
                </div>
              );
            }
            return <UnifiedRow key={i} row={row} />;
          })}
        </pre>
      ) : (
        <pre className="diff">
          {rows.map((row, i) => <SplitRow key={i} row={row} />)}
        </pre>
      )}
      {result.truncated && <div className="diff-empty">Diff truncated at 2000 lines.</div>}
    </div>
  );
}
