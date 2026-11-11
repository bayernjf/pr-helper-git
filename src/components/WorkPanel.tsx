import { errorMessage, errorDetail } from '../lib/errors';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  amendCommit,
  cleanDryRun,
  cleanForce,
  commitChanges,
  discardFile,
  generateCommitMessage,
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
import { STORAGE_KEYS } from '../lib/storage-keys';
import DiffView from './DiffView';
import { Group, TreeRow } from './WorkPanelTree';
import { Dropdown } from './Dropdown';
import FileViewer from './FileViewer';
import NewFileModal from './NewFileModal';
import RenameFileModal from './RenameFileModal';
import {
  IconBroom,
  IconPlus,
  IconUndo,
  IconClock,
} from './icons';
import { useConfirm } from './ui';
import { t, tp } from '../i18n';

interface Selection {
  path: string;
  area: FileArea;
}

function countLine(message: string): string {
  const first = message.split('\n')[0] || '';
  const len = first.length;
  if (len === 0) return '';
  if (len > 72) return `${len} > 72`;
  if (len > 50) return `${len} / 72`;
  return `${len} / 50`;
}

export default function WorkPanel() {
  const { activeRepo, status, runAction, commits, toast } = useApp();
  const confirm = useConfirm();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [message, setMessage] = useState(() =>
    activeRepo ? localStorage.getItem(STORAGE_KEYS.draft(activeRepo)) || '' : '');
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyKey = STORAGE_KEYS.commitHistory;
  const loadHistory = (): string[] => {
    try {
      const raw = localStorage.getItem(historyKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  };
  const saveHistory = (text: string) => {
    const list = loadHistory().filter((x) => x !== text);
    localStorage.setItem(historyKey, JSON.stringify([text, ...list].slice(0, 10)));
  };
  useEffect(() => {
    setMessage(activeRepo ? localStorage.getItem(STORAGE_KEYS.draft(activeRepo)) || '' : '');
  }, [activeRepo]);
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
  const [showNewFile, setShowNewFile] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Draft a commit message from the staged diff. The key lives server-side;
  // the browser only receives the finished text.
  async function handleGenerate() {
    if (!activeRepo) return;
    setGenerating(true);
    try {
      const res = await generateCommitMessage(activeRepo);
      setMessage(res.message);
    } catch (err) {
      toast(errorDetail(err) ? `${errorMessage(err)}: ${errorDetail(err)}` : errorMessage(err), 'error');
    } finally {
      setGenerating(false);
    }
  }

  const startResize = (event: React.PointerEvent) => {
    event.preventDefault();
    const startY = event.clientY;
    const startH = panelHeight;
    let latest = startH;
    const move = (ev: PointerEvent) => {
      // Dragging the handle upward grows the working panel.
      latest = Math.min(640, Math.max(140, startH + (startY - ev.clientY)));
      setPanelHeight(latest);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      // Persist only when the drag finishes, not on every pointer move.
      if (activeRepo) setPref(repoPref(activeRepo, 'panelHeight'), latest);
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
  }, [selection, activeRepo, ignoreWs, context]);

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
        ? 'This untracked file is deleted from disk directly. It is not tracked by Git, so no deletion is staged.'
        : 'git rm removes the file and stages the deletion; commit to finalize.',
    );
    if (!ok) return;
    // The server deletes untracked files directly (unlink); tracked files go
    // through `git rm`, which needs force when the working tree has changes.
    const force = file.area === 'untracked';
    await runAction(removeFile(activeRepo!, file.path, force), `Deleted ${file.path}`);
  }

  // Discard every unstaged + untracked change (git-side "Discard All" parity).
  async function handleDiscardAll() {
    const files = [...groups.unstaged, ...groups.untracked].map((f) => f.path);
    if (files.length === 0) return;
    const ok = await confirm(
      t('Discard all changes?'),
      tp('{count} file(s) will be reverted or deleted. This cannot be undone.', { count: files.length }),
    );
    if (!ok) return;
    const results = await Promise.allSettled(files.map((p) =>
      groups.untracked.some((u) => u.path === p) ? removeFile(activeRepo!, p) : discardFile(activeRepo!, p),
    ));
    const failed = results.filter((r) => r.status === 'rejected').length;
    await runAction(Promise.resolve(), failed === 0 ? 'All changes discarded' : `${failed} file(s) failed`);
  }

  async function handleClean() {
    try {
      const preview = await cleanDryRun(activeRepo!);
      if (preview.paths.length === 0) {
        toast(t("Nothing to clean"), 'info');
        return;
      }
      const proceed = await confirm(
        `Remove ${preview.paths.length} untracked item${preview.paths.length === 1 ? '' : 's'}?`,
        preview.paths.slice(0, 12).join('\n') + (preview.paths.length > 12 ? '\n…' : ''),
      );
      if (!proceed) return;
      const result = await cleanForce(activeRepo!);
      toast(`Removed ${result.removed.length} item${result.removed.length === 1 ? '' : 's'}`, 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  async function handleSubmit() {
    const text = message.trim();
    if (!text) return;
    if (amend) {
      const result = await runAction(amendCommit(activeRepo!, text), 'Last commit amended');
      if (result !== null) {
        saveHistory(text);
        setMessage('');
        localStorage.removeItem(STORAGE_KEYS.draft(activeRepo!));
        setAmend(false);
      }
      return;
    }
    if (groups.staged.length === 0 && !allowEmpty) return;
    const result = await runAction(commitChanges(activeRepo!, text, allowEmpty), 'Committed');
    if (result !== null) {
      saveHistory(text);
      setMessage('');
      localStorage.removeItem(STORAGE_KEYS.draft(activeRepo!));
      setAllowEmpty(false);
    }
  }

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
        title={t("Drag to resize")}
        onPointerDown={startResize}
        role="separator"
        aria-orientation="horizontal"
      >
        <span className="resize-grip" />
      </div>
      <div className="work-content">
        <div className="file-list">
          <div className="file-list-head">
            <button
              type="button"
              className="new-file-btn"
              title={t("Create a new file in this repository")}
              onClick={() => setShowNewFile(true)}
            >
              <IconPlus width={13} height={13} /> {t("New file")}
            </button>
          </div>
          <Group
            title={t("Staged changes")}
            files={groups.staged}
            allLabel={t("Unstage all")}
            onAll={() => runAction(stageAll(activeRepo!, 'unstage'), 'Unstaged all')}
          >
            {renderTree(trees.staged, 'staged', false)}
          </Group>
          <Group
            title={t("Unstaged changes")}
            files={groups.unstaged}
            allLabel={t("Stage all")}
            onAll={() => runAction(stageAll(activeRepo!, 'stage'), 'Staged all')}
          >
            {renderTree(trees.unstaged, 'unstaged', true)}
          </Group>
          <Group
            title={t("Untracked files")}
            files={groups.untracked}
            allLabel="Stage all"
            onAll={() => runAction(stageAll(activeRepo!, 'stage'), 'Staged all')}
            extra={
              <>
                <button
                  type="button"
                  title={t('Discard all unstaged and untracked changes')}
                  onClick={handleDiscardAll}
                >
                  <IconUndo width={13} height={13} /> {t('Discard all')}
                </button>
                <button
                  type="button"
                  title={t('Clean untracked files')}
                  onClick={handleClean}
                >
                  <IconBroom width={13} height={13} /> {t('Clean')}
                </button>
              </>
            }
          >
            {renderTree(trees.untracked, 'untracked', false)}
          </Group>
        </div>

        <div className="diff-controls">
          <button
            type="button"
            className={`ws-toggle${ignoreWs ? ' active' : ''}`}
            title={t("Ignore whitespace changes (-w)")}
            onClick={() => setIgnoreWs((v) => !v)}
          >
            {t("Ignore whitespace")}
          </button>
          <label className="context-picker">
            {t("Context")}
            <Dropdown
              value={context === undefined ? '' : String(context)}
              title={t('Diff context lines (--unified)')}
              onChange={(v) => setContext(v === '' ? undefined : Number(v))}
              options={[
                { value: '', label: t('Default (3)') },
                { value: '0', label: t('0 lines') },
                { value: '3', label: t('3 lines') },
                { value: '6', label: t('6 lines') },
                { value: '10', label: t('10 lines') },
              ]}
            />
          </label>
        </div>
        <DiffView
          result={diff}
          repo={activeRepo ?? undefined}
          staged={selection?.area === 'staged'}
        />
      </div>

      <div className="commit-form">
        <div className="commit-form-row">
          <textarea
            placeholder={t("Summary of the staged changes…")}
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              if (activeRepo) localStorage.setItem(STORAGE_KEYS.draft(activeRepo), e.target.value);
            }}
            onKeyDown={(e) => {
              // Scope Cmd/Ctrl+Enter to this textarea only, so editors and other
              // dialogs that also handle the shortcut do not submit behind them.
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
          <span className="commit-count" aria-hidden="true">{countLine(message)}</span>
        </div>
        <div className="form-side" style={{ position: 'relative' }}>
          {historyOpen && (
            <div className="commit-history">
              {loadHistory().length === 0 && <div className="dropdown-empty">{t('No history yet.')}</div>}
              {loadHistory().map((msg, i) => (
                <div
                  key={`${i}-${msg.slice(0, 24)}`}
                  className="dropdown-item"
                  onClick={() => {
                    setMessage(msg);
                    if (activeRepo) localStorage.setItem(STORAGE_KEYS.draft(activeRepo), msg);
                    setHistoryOpen(false);
                  }}
                >
                  {msg.split('\n')[0]}
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            className="amend-toggle"
            title={t('Recent commit messages')}
            aria-label={t('Recent commit messages')}
            onClick={() => setHistoryOpen((v) => !v)}
          >
            <IconClock width={13} height={13} />
            {t('History')}
          </button>
          <button
            type="button"
            className="amend-toggle"
            title={t("Draft a commit message from the staged diff with AI")}
            disabled={generating || groups.staged.length === 0}
            onClick={handleGenerate}
          >
            {generating ? t('Generating…') : t('Generate with AI')}
          </button>
          {commits.length > 0 && (
            <button
              type="button"
              className={`amend-toggle${amend ? ' on' : ''}`}
              onClick={() => {
                setAmend((v) => {
                  const next = !v;
                  if (next && !message.trim() && commits[0]) setMessage(commits[0].subject);
                  return next;
                });
              }}
            >
              <IconUndo width={13} height={13} />
              {t("Amend last commit")}
            </button>
          )}
          {!amend && groups.staged.length === 0 && (
            <button
              type="button"
              className={`amend-toggle${allowEmpty ? ' on' : ''}`}
              title={t("Create a commit even when nothing is staged (--allow-empty)")}
              onClick={() => setAllowEmpty((v) => !v)}
            >
              {t("Allow empty")}
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {amend
              ? t('Amend')
              : groups.staged.length === 0 && allowEmpty
                ? t('Commit (empty)')
                : tp('Commit ({count})', { count: groups.staged.length })}
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
      {showNewFile && (
        <NewFileModal
          onClose={() => setShowNewFile(false)}
          onCreated={(path) => setEditTarget(path)}
        />
      )}
    </section>
  );
}