import { useEffect, useMemo, useState } from 'react';
import {
  commitChanges,
  discardFile,
  getDiff,
  stageAll,
  stageFile,
} from '../api';
import { useApp } from '../app-state';
import type { DiffResult, FileArea, StatusFile } from '../types';
import DiffView from './DiffView';
import { useConfirm } from './ui';

interface Selection {
  path: string;
  area: FileArea;
}

function statusLabel(file: StatusFile): string {
  if (file.area === 'untracked') return 'U';
  if (file.area === 'unmerged') return '!';
  return file.status.trim() || 'M';
}

function FileRow({
  file,
  selected,
  onSelect,
  onStageToggle,
  onDiscard,
}: {
  file: StatusFile;
  selected: boolean;
  onSelect: () => void;
  onStageToggle: () => void;
  onDiscard?: () => void;
}) {
  const isStaged = file.area === 'staged';
  return (
    <div className={`file-row${selected ? ' selected' : ''}`} onClick={onSelect}>
      <button
        type="button"
        className="file-stage-btn"
        title={isStaged ? 'Unstage' : 'Stage'}
        onClick={(e) => {
          e.stopPropagation();
          onStageToggle();
        }}
      >
        {isStaged ? '−' : '+'}
      </button>
      <span className={`file-status-code ${file.area}`}>{statusLabel(file)}</span>
      <span className="file-name">{file.path}</span>
      {onDiscard && (
        <button
          type="button"
          className="file-stage-btn"
          title="Discard changes"
          onClick={(e) => {
            e.stopPropagation();
            onDiscard();
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

function Group({
  title,
  files,
  actionLabel,
  onActionAll,
  children,
}: {
  title: string;
  files: StatusFile[];
  actionLabel?: string;
  onActionAll?: () => void;
  children: React.ReactNode;
}) {
  if (files.length === 0) return null;
  return (
    <>
      <div className="file-group-title">
        <span>{title} ({files.length})</span>
        {actionLabel && (
          <button type="button" className="mini-btn" onClick={onActionAll} title={actionLabel}>
            {actionLabel}
          </button>
        )}
      </div>
      {children}
    </>
  );
}

export default function WorkPanel() {
  const { activeRepo, status, runAction } = useApp();
  const confirm = useConfirm();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [message, setMessage] = useState('');

  const groups = useMemo(() => {
    const files = status?.files || [];
    return {
      staged: files.filter((f) => f.area === 'staged'),
      unstaged: files.filter((f) => f.area === 'unstaged' || f.area === 'unmerged'),
      untracked: files.filter((f) => f.area === 'untracked'),
    };
  }, [status]);

  // Clear a stale selection after the file list changes.
  useEffect(() => {
    if (selection) {
      const exists = status?.files.some((f) => f.path === selection.path && f.area === selection.area);
      if (!exists) {
        setSelection(null);
        setDiff(null);
      }
    }
  }, [status, selection]);

  // Load the diff whenever the selection or underlying status changes.
  useEffect(() => {
    if (!selection || !activeRepo) {
      setDiff(null);
      return;
    }
    let cancelled = false;
    getDiff(activeRepo, selection.path, selection.area === 'staged')
      .then((result) => {
        if (!cancelled) setDiff(result);
      })
      .catch(() => {
        if (!cancelled) setDiff(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selection, activeRepo, status]);

  async function handleDiscard(file: StatusFile) {
    const ok = await confirm(
      `Discard changes to ${file.path}?`,
      'git restore reverts the working-tree file permanently; this cannot be undone.',
    );
    if (ok) await runAction(discardFile(activeRepo!, file.path), 'Changes discarded');
  }

  async function handleCommit() {
    const text = message.trim();
    if (!text || groups.staged.length === 0) return;
    const result = await runAction(commitChanges(activeRepo!, text), 'Committed');
    if (result !== null) setMessage('');
  }

  return (
    <section className="work-panel">
      <div className="work-body">
        <div className="file-list">
          <Group
            title="Staged changes"
            files={groups.staged}
            actionLabel="Unstage all"
            onActionAll={() => runAction(stageAll(activeRepo!, 'unstage'), 'Unstaged all')}
          >
            {groups.staged.map((file) => (
              <FileRow
                key={`s-${file.path}`}
                file={file}
                selected={selection?.path === file.path && selection.area === file.area}
                onSelect={() => setSelection({ path: file.path, area: file.area })}
                onStageToggle={() =>
                  runAction(stageFile(activeRepo!, file.path, 'unstage'), 'Unstaged')}
              />
            ))}
          </Group>

          <Group
            title="Unstaged changes"
            files={groups.unstaged}
            actionLabel="Stage all"
            onActionAll={() => runAction(stageAll(activeRepo!, 'stage'), 'Staged all')}
          >
            {groups.unstaged.map((file) => (
              <FileRow
                key={`u-${file.path}`}
                file={file}
                selected={selection?.path === file.path && selection.area === file.area}
                onSelect={() => setSelection({ path: file.path, area: file.area })}
                onStageToggle={() =>
                  runAction(stageFile(activeRepo!, file.path, 'stage'), 'Staged')}
                onDiscard={file.area === 'unmerged' ? undefined : () => handleDiscard(file)}
              />
            ))}
          </Group>

          <Group title="Untracked files" files={groups.untracked}>
            {groups.untracked.map((file) => (
              <FileRow
                key={`t-${file.path}`}
                file={file}
                selected={selection?.path === file.path && selection.area === file.area}
                onSelect={() => setSelection({ path: file.path, area: file.area })}
                onStageToggle={() =>
                  runAction(stageFile(activeRepo!, file.path, 'stage'), 'Staged')}
              />
            ))}
          </Group>
        </div>

        <DiffView result={diff} />
      </div>

      <div className="commit-box">
        <textarea
          className="input"
          placeholder="Summary of the staged changes…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-primary"
          disabled={groups.staged.length === 0 || !message.trim()}
          onClick={handleCommit}
        >
          Commit ({groups.staged.length})
        </button>
      </div>
    </section>
  );
}
