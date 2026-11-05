import { useMemo, useState } from 'react';
import {
  checkoutRef,
  deleteBranch,
  mergeRef,
  stashApply,
  stashDrop,
} from '../api';
import { useApp } from '../app-state';
import { laneColor } from './CommitGraph';
import NewBranchModal from './NewBranchModal';
import { useConfirm } from './ui';
import type { Ref } from '../types';

function RefRow({
  item,
  current,
  dotColor,
  onClick,
  children,
  title,
}: {
  item?: Ref;
  current?: boolean;
  dotColor: string;
  onClick: () => void;
  children?: React.ReactNode;
  title?: string;
}) {
  const name = item ? item.shortName : title;
  return (
    <div className={`ref-item${current ? ' current' : ''}`} onClick={onClick} title={name}>
      <span className="ref-dot" style={{ background: dotColor }} />
      <span className="ref-name">{name}</span>
      {children}
    </div>
  );
}

export default function RefSidebar() {
  const {
    activeRepo,
    refs,
    status,
    runAction,
  } = useApp();
  const confirm = useConfirm();
  const [showNew, setShowNew] = useState(false);

  const groups = useMemo(() => {
    const local = refs.filter((r) => r.name.startsWith('refs/heads/'));
    const remote = refs.filter(
      (r) => r.name.startsWith('refs/remotes/') && !r.name.endsWith('/HEAD'),
    );
    const tags = refs.filter((r) => r.name.startsWith('refs/tags/'));
    const stash = refs.find((r) => r.name === 'refs/stash');
    return { local, remote, tags, stash };
  }, [refs]);

  const currentBranch = status?.branch;

  async function handleDelete(branch: string) {
    const ok = await confirm(
      `Delete branch ${branch}?`,
      'A safe delete (-d) is attempted first. If the branch is unmerged, you can force the delete.',
    );
    if (!ok) return;
    const result = await runAction(deleteBranch(activeRepo!, branch, false));
    if (result === null) {
      const force = await confirm(`Force delete ${branch}?`, 'Unmerged work will be lost.');
      if (force) await runAction(deleteBranch(activeRepo!, branch, true), `Deleted ${branch}`);
    }
  }

  async function handleMerge(branch: string) {
    const ok = await confirm(
      `Merge ${branch} into ${currentBranch}?`,
      'git merge --no-edit; conflicts, if any, must be resolved manually.',
    );
    if (ok) await runAction(mergeRef(activeRepo!, branch), `Merged ${branch}`);
  }

  return (
    <aside className="ref-sidebar">
      <div className="ref-section">
        <div className="ref-section-title">
          <span>Local branches</span>
          <button
            type="button"
            className="mini-btn"
            title="Create branch"
            onClick={() => setShowNew(true)}
          >
            +
          </button>
        </div>
        {groups.local.map((r, i) => {
          const isCurrent = r.shortName === currentBranch;
          return (
            <RefRow
              key={r.name}
              item={r}
              current={isCurrent}
              dotColor={laneColor(i)}
              onClick={() => {
                if (!isCurrent) {
                  runAction(checkoutRef(activeRepo!, r.shortName), `Checked out ${r.shortName}`);
                }
              }}
            >
              {!isCurrent && (
                <span className="row-actions">
                  <button
                    type="button"
                    className="mini-btn"
                    title={`Merge ${r.shortName} into current branch`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMerge(r.shortName);
                    }}
                  >
                    ⤵
                  </button>
                  <button
                    type="button"
                    className="mini-btn"
                    title="Delete branch"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(r.shortName);
                    }}
                  >
                    ×
                  </button>
                </span>
              )}
            </RefRow>
          );
        })}
      </div>

      <div className="ref-section">
        <div className="ref-section-title">
          <span>Remote branches</span>
        </div>
        {groups.remote.map((r) => (
          <RefRow
            key={r.name}
            item={r}
            dotColor="#3a6b48"
            onClick={() => runAction(checkoutRef(activeRepo!, r.shortName), `Checked out ${r.shortName}`)}
          />
        ))}
      </div>

      <div className="ref-section">
        <div className="ref-section-title">
          <span>Tags</span>
        </div>
        {groups.tags.map((r) => (
          <RefRow
            key={r.name}
            item={r}
            dotColor="var(--yellow)"
            onClick={() => runAction(checkoutRef(activeRepo!, r.shortName), `Checked out ${r.shortName}`)}
          />
        ))}
      </div>

      {groups.stash && (
        <div className="ref-section">
          <div className="ref-section-title">
            <span>Stash</span>
          </div>
          <RefRow
            item={groups.stash}
            dotColor="var(--purple)"
            onClick={() => runAction(stashApply(activeRepo!, 0, false), 'Stash applied')}
          >
            <span className="row-actions">
              <button
                type="button"
                className="mini-btn"
                title="Pop (apply and drop)"
                onClick={(e) => {
                  e.stopPropagation();
                  runAction(stashApply(activeRepo!, 0, true), 'Stash popped');
                }}
              >
                ⤵
              </button>
              <button
                type="button"
                className="mini-btn"
                title="Drop stash"
                onClick={(e) => {
                  e.stopPropagation();
                  runAction(stashDrop(activeRepo!, 0), 'Stash dropped');
                }}
              >
                ×
              </button>
            </span>
          </RefRow>
        </div>
      )}

      {showNew && <NewBranchModal onClose={() => setShowNew(false)} />}
    </aside>
  );
}
