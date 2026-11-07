import { useEffect, useMemo, useRef, useState } from 'react';
import {
  amendCommit,
  cleanDryRun,
  cleanForce,
  commitChanges,
  discardFile,
  getCommitTemplate,
  getDiff,
  ignoreFile,
  removeFile,
  stageAll,
  stageFile,
} from '../api';
import { useApp } from '../app-state';
import type { DiffResult, FileArea, StatusFile } from '../types';
import { buildFileTree, flattenTree, type TreeNode } from '../lib/file-tree';
import { getPref, setPref, repoPref } from '../lib/prefs';
import DiffView from './DiffView';
import FileViewer from './FileViewer';
import RenameFileModal from './RenameFileModal';
import {
  IconBan,
  IconBroom,
  IconChevronDown,
  IconChevronRight,
  IconEdit,
  IconEye,
  IconFile,
  IconFolder,
  IconPencil,
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
  onView,
  onEditContent,
  onDiscard,
  onIgnore,
  onRename,
  onDelete,
}: {
  node: TreeNode;
  collapsed: Set<string>;
  toggleFolder: (path: string) => void;
  selected: boolean;
  onSelect: () => void;
  onStageToggle: () => void;
  onView: () => void;
  onEditContent?: () => void;
  onDiscard?: () => void;
  onIgnore?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}) {
  if (node.folder) {
    const isCollapsed = collapsed.has(node.path);
    return (
      <div className="tree-folder" style={{ paddingLeft: 10 + node.depth * 13 }}>
        <button
          type="button"
          className="icon-btn"
          style={{ width: 18, height: 18 }}
          aria-label={isCollapsed ? `Expand ${node.name}` : `Collapse ${node.name}`}
          title={isCollapsed ? 'Expand folder' : 'Collapse folder'}
          aria-expanded={!isCollapsed}
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
        <button
          type="button"
          title="View file content"
          onClick={(e) => {
            e.stopPropagation();
            onView();
          }}
        >
          <IconEye width={13} height={13} />
        </button>
        {onEditContent && (
          <button
            type="button"
            title="Edit file content"
            onClick={(e) => {
              e.stopPropagation();
              onEditContent();
            }}
          >
            <IconPencil width={13} height={13} />
          </button>
        )}
        {onRename && (
          <button
            type="button"
            title="Rename or move (git mv)"
            onClick={(e) => {
              e.stopPropagation();
              onRename();
            }}
          >
            <IconEdit width={13} height={13} />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            title="Delete file (git rm)"
            className="action-danger"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <IconTrash width={13} height={13} />
          </button>
        )}
        {onIgnore && (
          <button
            type="button"
            title="Add to .gitignore"
            onClick={(e) => {
              e.stopPropagation();
              onIgnore();
            }}
          >
            <IconBan width={13} height={13} />
          </button>
        )}
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
  extra,
  children,
}: {
  title: string;
  files: StatusFile[];
  allLabel: string;
  onAll: () => void;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  if (files.length === 0) return null;
  return (
    <>
      <div className="file-group-label">
        {title}
        <span className="mini-actions">
          {extra}
          <button type="button" onClick={onAll}>{allLabel}</button>
        </span>
      </div>
      {children}
    </>
  );
}

export default function WorkPanel() {
  const { activeRepo, status, runAction, commits, toast } = useApp();
  const confirm = useConfirm();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [message, setMessage] = useState('');
  const [amend, setAmend] = useState(false);
  const [ignoreWs, setIgnoreWs] = useState(false);
  const [context, setContext] = useState<number | undefined>(undefined);
  const [allowEmpty, setAllowEmpty] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [panelHeight, setPanelHeight] = useState(() =>
    activeRepo ? getPref(repoPref(activeRepo, 'panelHeight'), 300) : 300);
  const [viewer, setViewer] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);

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
      // Persist only when the drag finishes, not on every pointer move.
      if (activeRepo) {
        setPanelHeight((current) => {
          setPref(repoPref(activeRepo, 'panelHeight'), current);
          return current;
        });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Restore the saved panel height when switching repositories. The lazy
  // useState initializer only runs once on mount, so without this effect the
  // first repository's height would leak into every later repository.
  useEffect(() => {
    if (!activeRepo) return;
    setPanelHeight(getPref(repoPref(activeRepo, 'panelHeight'), 300));
  }, [activeRepo]);

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

  // Prefill the commit message from the configured `commit.template` when the
  // repository changes and the field is still empty, so user edits are kept.
  const messageRef = useRef(message);
  messageRef.current = message;
  useEffect(() => {
    if (!activeRepo) return;
    let cancelled = false;
    getCommitTemplate(activeRepo)
      .then((res) => {
        if (!cancelled && res.configured && res.text && !messageRef.current.trim()) {
          setMessage(res.text);
        }
      })
      .catch(() => { /* template is optional; ignore failures */ });
    return () => { cancelled = true; };
  }, [activeRepo]);

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
    getDiff(activeRepo, selection.path, selection.area === 'staged', ignoreWs, context)
      .then((result) => {
        if (!cancelled) setDiff(result);
      })
      .catch(() => {
        if (!cancelled) setDiff(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selection, activeRepo, status, ignoreWs, context]);

  async function handleDiscard(file: StatusFile) {
    const ok = await confirm(
      `Discard changes to ${file.path}?`,
      'git restore reverts the working-tree file permanently; this cannot be undone.',
    );
    if (ok) await runAction(discardFile(activeRepo!, file.path), 'Changes discarded');
  }

  async function handleIgnore(file: StatusFile) {
    await runAction(ignoreFile(activeRepo!, file.path), `Added ${file.path} to .gitignore`);
  }

  async function handleRemove(file: StatusFile) {
    const ok = await confirm(
      `Delete ${file.path}?`,
      file.area === 'untracked'
        ? 'git rm -f removes the file and stages its deletion.'
        : 'git rm removes the file and stages the deletion; commit to finalize.',
    );
    if (!ok) return;
    // Untracked files are not in HEAD yet, so git rm needs the force flag.
    const force = file.area === 'untracked';
    await runAction(removeFile(activeRepo!, file.path, force), `Deleted ${file.path}`);
  }

  async function handleClean() {
    try {
      const preview = await cleanDryRun(activeRepo!);
      if (preview.paths.length === 0) {
        toast('Nothing to clean', 'info');
        return;
      }
      const proceed = await confirm(
        `Remove ${preview.paths.length} untracked item${preview.paths.length === 1 ? '' : 's'}?`,
        preview.paths.slice(0, 12).join('\n') + (preview.paths.length > 12 ? '\n…' : ''),
      );
      if (!proceed) return;
      const result = await cleanForce(activeRepo!);
      toast(`Removed ${result.removed.length} item${result.removed.length === 1 ? '' : 's'}`, 'success');
    } catch (err: any) {
      toast(err.message, 'error');
    }
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
    if (groups.staged.length === 0 && !allowEmpty) return;
    const result = await runAction(commitChanges(activeRepo!, text, allowEmpty), 'Committed');
    if (result !== null) {
      setMessage('');
      setAllowEmpty(false);
    }
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
        onView={() => setViewer(node.path)}
        onEditContent={node.file && node.file.area !== 'unmerged'
          ? () => setEditTarget(node.path)
          : undefined}
        onRename={node.file && node.file.area !== 'unmerged'
          ? () => setRenameTarget(node.path)
          : undefined}
        onDelete={node.file && node.file.area !== 'unmerged'
          ? () => handleRemove(node.file!)
          : undefined}
        onDiscard={allowDiscard && node.file && node.file.area !== 'unmerged'
          ? () => handleDiscard(node.file!)
          : undefined}
        onIgnore={area === 'untracked' && node.file
          ? () => handleIgnore(node.file!)
          : undefined}
      />
    ));

  const canSubmit = !!message.trim()
    && (amend || groups.staged.length > 0 || allowEmpty);

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
            extra={
              <button
                type="button"
                title="Clean untracked files"
                onClick={handleClean}
              >
                <IconBroom width={13} height={13} /> Clean
              </button>
            }
          >
            {renderTree(trees.untracked, 'untracked', false)}
          </Group>
        </div>

        <div className="diff-controls">
          <button
            type="button"
            className={`ws-toggle${ignoreWs ? ' active' : ''}`}
            title="Ignore whitespace changes (-w)"
            onClick={() => setIgnoreWs((v) => !v)}
          >
            Ignore whitespace
          </button>
          <label className="context-picker">
            Context
            <select
              value={context === undefined ? '' : context}
              title="Diff context lines (--unified)"
              onChange={(e) => setContext(e.target.value === '' ? undefined : Number(e.target.value))}
            >
              <option value="">Default (3)</option>
              <option value={0}>0 lines</option>
              <option value={3}>3 lines</option>
              <option value={6}>6 lines</option>
              <option value={10}>10 lines</option>
            </select>
          </label>
        </div>
        <DiffView
          result={diff}
          repo={activeRepo ?? undefined}
          staged={selection?.area === 'staged'}
        />
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
          {!amend && groups.staged.length === 0 && (
            <button
              type="button"
              className={`amend-toggle${allowEmpty ? ' on' : ''}`}
              title="Create a commit even when nothing is staged (--allow-empty)"
              onClick={() => setAllowEmpty((v) => !v)}
            >
              Allow empty
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {amend
              ? 'Amend'
              : groups.staged.length === 0 && allowEmpty
                ? 'Commit (empty)'
                : `Commit (${groups.staged.length})`}
          </button>
        </div>
      </div>

      {viewer && activeRepo && (
        <FileViewer
          repo={activeRepo}
          filePath={viewer}
          onClose={() => setViewer(null)}
        />
      )}
      {editTarget && activeRepo && (
        <FileViewer
          repo={activeRepo}
          filePath={editTarget}
          initialMode="edit"
          onClose={() => setEditTarget(null)}
        />
      )}
      {renameTarget && (
        <RenameFileModal path={renameTarget} onClose={() => setRenameTarget(null)} />
      )}
    </section>
  );
}
