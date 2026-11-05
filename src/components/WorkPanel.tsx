import { useEffect, useMemo, useRef, useState } from 'react';
import {
  amendCommit,
  commitChanges,
  discardFile,
  getDiff,
  stageAll,
  stageFile,
} from '../api';
import { useApp } from '../app-state';
import type { DiffResult, FileArea, StatusFile } from '../types';
import { buildFileTree, flattenTree, type TreeNode } from '../lib/file-tree';
import DiffView from './DiffView';
import {
  IconChevronDown,
  IconChevronRight,
  IconFile,
  IconFolder,
  IconPlus,
  IconTrash,
  IconUndo,
  IconX,
} from './icons';
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

function TreeRow({
  node,
  collapsed,
  toggleFolder,
  selected,
  onSelect,
  onStageToggle,
  onDiscard,
}: {
  node: TreeNode;
  collapsed: Set<string>;
  toggleFolder: (path: string) => void;
  selected: boolean;
  onSelect: () => void;
  onStageToggle: () => void;
  onDiscard?: () => void;
}) {
  if (node.folder) {
    const isCollapsed = collapsed.has(node.path);
    return (
      <div className="tree-folder" style={{ paddingLeft: 10 + node.depth * 13 }}>
        <button
          type="button"
          className="icon-btn"
          style={{ width: 18, height: 18 }}
          onClick={() => toggleFolder(node.path)}
        >
          {isCollapsed ? <IconChevronRight width={13} height={13} /> : <IconChevronDown width={13} height={13} />}
        </button>
        <IconFolder width={14} height={14} />
        {node.name}
      </div>
    );
  }

  const file = node.file!;
  const isStaged = file.area === 'staged';
  return (
    <div
      className={`file-row tree-row${selected ? ' selected' : ''}`}
      style={{ paddingLeft: 10 + node.depth * 13 }}
      onClick={onSelect}
    >
      <button
        type="button"
        className="icon-btn"
        style={{ width: 20, height: 20, color: isStaged ? 'var(--accent)' : 'var(--green)' }}
        title={isStaged ? 'Unstage' : 'Stage'}
        onClick={(e) => {
          e.stopPropagation();
          onStageToggle();
        }}
      >
        {isStaged ? <IconX width={13} height={13} /> : <IconPlus width={14} height={14} />}
      </button>
      <span className={`status-code ${file.area}`}>{statusLabel(file)}</span>
      <IconFile width={13} height={13} style={{ color: 'var(--faint)' }} />
      <span className="file-path">{node.name}</span>
      <span className="file-actions">
        {onDiscard && (
          <button
            type="button"
            title="Discard changes"
            onClick={(e) => {
              e.stopPropagation();
              onDiscard();
            }}
          >
            <IconTrash width={13} height={13} />
          </button>
        )}
      </span>
    </div>
  );
}

function Group({
  title,
  files,
  allLabel,
  onAll,
  children,
}: {
  title: string;
  files: StatusFile[];
  allLabel: string;
  onAll: () => void;
  children: React.ReactNode;
}) {
  if (files.length === 0) return null;
  return (
    <>
      <div className="file-group-label">
        {title}
        <span className="mini-actions">
          <button type="button" onClick={onAll}>{allLabel}</button>
        </span>
      </div>
      {children}
    </>
  );
}

export default function WorkPanel() {
  const { activeRepo, status, runAction, commits } = useApp();
  const confirm = useConfirm();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [message, setMessage] = useState('');
  const [amend, setAmend] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [panelHeight, setPanelHeight] = useState(300);

  const startResize = (event: React.PointerEvent) => {
    event.preventDefault();
    const startY = event.clientY;
    const startH = panelHeight;
    const move = (ev: PointerEvent) => {
      // Dragging the handle upward grows the working panel.
      const next = Math.min(640, Math.max(140, startH + (startY - ev.clientY)));
      setPanelHeight(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const groups = useMemo(() => {
    const files = status?.files || [];
    return {
      staged: files.filter((f) => f.area === 'staged'),
      unstaged: files.filter((f) => f.area === 'unstaged' || f.area === 'unmerged'),
      untracked: files.filter((f) => f.area === 'untracked'),
    };
  }, [status]);

  const trees = useMemo(() => ({
    staged: buildFileTree(groups.staged),
    unstaged: buildFileTree(groups.unstaged),
    untracked: buildFileTree(groups.untracked),
  }), [groups]);

  const toggleFolder = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

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

  // Load the diff whenever the selection changes.
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

  async function handleSubmit() {
    const text = message.trim();
    if (!text) return;
    if (amend) {
      const result = await runAction(amendCommit(activeRepo!, text), 'Last commit amended');
      if (result !== null) {
        setMessage('');
        setAmend(false);
      }
      return;
    }
    if (groups.staged.length === 0) return;
    const result = await runAction(commitChanges(activeRepo!, text), 'Committed');
    if (result !== null) setMessage('');
  }

  // Cmd/Ctrl+Enter submits the form without needing the button focused.
  const submitRef = useRef<() => void>(() => {});
  submitRef.current = handleSubmit;
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        submitRef.current();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const renderTree = (list: TreeNode[], area: FileArea, allowDiscard: boolean) =>
    flattenTree(list, collapsed).map((node) => (
      <TreeRow
        key={`${node.path}-${node.folder}`}
        node={node}
        collapsed={collapsed}
        toggleFolder={toggleFolder}
        selected={selection?.path === node.path && selection?.area === area}
        onSelect={() => {
          if (!node.folder) setSelection({ path: node.path, area });
        }}
        onStageToggle={() => {
          if (node.folder || !node.file) return;
          runAction(
            stageFile(activeRepo!, node.path, area === 'staged' ? 'unstage' : 'stage'),
            area === 'staged' ? 'Unstaged' : 'Staged',
          );
        }}
        onDiscard={allowDiscard && node.file && node.file.area !== 'unmerged'
          ? () => handleDiscard(node.file!)
          : undefined}
      />
    ));

  const canSubmit = !!message.trim() && (amend || groups.staged.length > 0);

  return (
    <section className="work-panel" style={{ height: panelHeight }}>
      <div
        className="panel-resize-handle"
        title="Drag to resize"
        onPointerDown={startResize}
        role="separator"
        aria-orientation="horizontal"
      >
        <span className="resize-grip" />
      </div>
      <div className="work-content">
        <div className="file-list">
          <Group
            title="Staged changes"
            files={groups.staged}
            allLabel="Unstage all"
            onAll={() => runAction(stageAll(activeRepo!, 'unstage'), 'Unstaged all')}
          >
            {renderTree(trees.staged, 'staged', false)}
          </Group>
          <Group
            title="Unstaged changes"
            files={groups.unstaged}
            allLabel="Stage all"
            onAll={() => runAction(stageAll(activeRepo!, 'stage'), 'Staged all')}
          >
            {renderTree(trees.unstaged, 'unstaged', true)}
          </Group>
          <Group
            title="Untracked files"
            files={groups.untracked}
            allLabel="Stage all"
            onAll={() => runAction(stageAll(activeRepo!, 'stage'), 'Staged all')}
          >
            {renderTree(trees.untracked, 'untracked', false)}
          </Group>
        </div>

        <DiffView result={diff} />
      </div>

      <div className="commit-form">
        <textarea
          placeholder="Summary of the staged changes…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <div className="form-side">
          {commits.length > 0 && (
            <button
              type="button"
              className={`amend-toggle${amend ? ' on' : ''}`}
              onClick={() => setAmend((v) => !v)}
            >
              <IconUndo width={13} height={13} />
              Amend last commit
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {amend ? 'Amend' : `Commit (${groups.staged.length})`}
          </button>
        </div>
      </div>
    </section>
  );
}
