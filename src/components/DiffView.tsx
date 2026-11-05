import { useMemo, useState } from 'react';
import type { DiffResult } from '../types';
import { parseDiffLines, type ParsedDiffLine } from '../lib/diff-lines';
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

export default function DiffView({ result }: { result: DiffResult | null }) {
  const [mode, setMode] = useState<'unified' | 'split'>('unified');
  const rows = useMemo(() => (result?.diff ? parseDiffLines(result.diff) : []), [result]);

  if (!result) return <EmptyHint>Select a file to review its changes.</EmptyHint>;
  if (result.masked) {
    return <EmptyHint>{result.path} is sensitive — its contents are masked.</EmptyHint>;
  }
  if (!result.diff) {
    return <EmptyHint>No diff available. Untracked files show a diff after staging.</EmptyHint>;
  }

  return (
    <div className="diff-pane">
      <div className="diff-toolbar">
        <span className="file-name">{result.path}</span>
        <Toggle mode={mode} setMode={setMode} />
      </div>
      {mode === 'unified' ? (
        <pre className="diff">
          {rows.map((row, i) => <UnifiedRow key={i} row={row} />)}
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
