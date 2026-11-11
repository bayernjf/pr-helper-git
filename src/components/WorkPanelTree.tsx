import type { ReactNode } from 'react';
import type { StatusFile } from '../types';
import type { TreeNode } from '../lib/file-tree';
import {
  IconBan,
  IconChevronDown,
  IconChevronRight,
  IconEdit,
  IconEye,
  IconFile,
  IconFolder,
  IconPencil,
  IconPlus,
  IconTrash,
  IconX,
} from './icons';
import { t } from '../i18n';

export function statusLabel(file: StatusFile): string {
  if (file.area === 'untracked') return 'U';
  if (file.area === 'unmerged') return '!';
  return file.status.trim() || 'M';
}

export function TreeRow({
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
          title={t("View file content")}
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
            title={t("Edit file content")}
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
            title={t("Delete file (git rm)")}
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
            title={t("Add to .gitignore")}
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
            title={t("Discard changes")}
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

export function Group({
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
  extra?: ReactNode;
  children: ReactNode;
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
