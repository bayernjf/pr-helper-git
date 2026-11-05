import { useMemo } from 'react';
import type { DiffResult } from '../types';

function lineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'diff-meta';
  if (line.startsWith('@@')) return 'diff-hunk';
  if (line.startsWith('+')) return 'diff-add';
  if (line.startsWith('-')) return 'diff-del';
  return '';
}

export default function DiffView({ result }: { result: DiffResult | null }) {
  const lines = useMemo(() => (result?.diff ? result.diff.split('\n') : []), [result]);

  if (!result) {
    return (
      <div className="diff-pane">
        <p className="diff-masked">Select a file to review its changes.</p>
      </div>
    );
  }

  if (result.masked) {
    return (
      <div className="diff-pane">
        <p className="diff-masked">
          {result.path} is treated as sensitive — its contents are masked.
        </p>
      </div>
    );
  }

  if (!result.diff) {
    return (
      <div className="diff-pane">
        <p className="diff-masked">
          No diff available. Untracked files show a diff after they are staged.
        </p>
      </div>
    );
  }

  return (
    <div className="diff-pane">
      <pre className="diff-text">
        {lines.map((line, i) => (
          <div key={i} className={lineClass(line)}>
            {line || ' '}
          </div>
        ))}
      </pre>
      {result.truncated && <p className="diff-masked">Diff truncated at 2000 lines.</p>}
    </div>
  );
}
