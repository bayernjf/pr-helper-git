// Interactive-rebase dialog. The server owns the truth: it re-reads the range
// and rejects any plan that is not a permutation of those commits, so this
// component only ever arranges rows and labels them.
import { useEffect, useState } from 'react';
import { rebaseInteractive, rebasePlan, type RebasePlan } from '../api';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import { shortHash } from '../lib/format';
import { IconAlert, IconX } from './icons';
import { t } from '../i18n';

type Action = 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop';

const ACTIONS: Action[] = ['pick', 'reword', 'edit', 'squash', 'fixup', 'drop'];

type Row = {
  hash: string;
  subject: string;
  authorName: string;
  action: Action;
  message: string;
};

export default function RebaseModal({ base, onClose }: { base: string; onClose: () => void }) {
  const { activeRepo, runAction, toast } = useApp();
  const [plan, setPlan] = useState<RebasePlan | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  useEscape(onClose);

  useEffect(() => {
    if (!activeRepo) return;
    let cancelled = false;
    setLoading(true);
    rebasePlan(activeRepo, base)
      .then((res) => {
        if (cancelled) return;
        setPlan(res);
        setRows(
          res.commits.map((commit) => ({
            hash: commit.hash,
            subject: commit.subject,
            authorName: commit.authorName,
            action: 'pick' as Action,
            message: commit.subject,
          })),
        );
      })
      .catch((err) => {
        if (!cancelled) toast(err?.message || 'could not load the rebase plan', 'error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeRepo, base, toast]);

  function move(index: number, delta: number): void {
    setRows((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function setAction(index: number, action: Action): void {
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, action } : row)),
    );
  }

  function setMessage(index: number, message: string): void {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, message } : row)));
  }

  const merges = plan?.merges ?? [];
  const blocked = !!plan?.dirty || merges.length > 0;
  // A squash/fixup on the first surviving row cannot run; catching it here
  // saves a round-trip to a 400.
  const firstLive = rows.findIndex((row) => row.action !== 'drop');
  const badFirst =
    firstLive >= 0 && (rows[firstLive].action === 'squash' || rows[firstLive].action === 'fixup');
  const rewordMissing = rows.some((row) => row.action === 'reword' && !row.message.trim());

  async function start(): Promise<void> {
    if (!activeRepo || saving || blocked || badFirst || rewordMissing) return;
    setSaving(true);
    if (!base) {
      setSaving(false);
      return;
    }
    // runAction already refreshes and toasts failures; it returns null then.
    const res = await runAction(
      rebaseInteractive(
        activeRepo,
        base,
        rows.map((row) => ({
          hash: row.hash,
          action: row.action,
          ...(row.action === 'reword' ? { message: row.message } : {}),
        })),
      ),
    );
    if (!res) {
      setSaving(false);
      return;
    }
    if ((res as { conflicted?: boolean }).conflicted) {
      toast(t("Rebase stopped on a conflict — resolve it in the work panel"), 'error');
    } else {
      toast(`Rebased ${rows.filter((row) => row.action !== 'drop').length} commit(s)`, 'success');
    }
    onClose();
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal modal-wide rebase-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t("Interactive rebase")}</h2>
          <span className="chip chip-muted mono">{base === 'root' ? 'whole branch' : shortHash(base)}</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="icon-btn" aria-label={t("Close")} title={t("Close")} onClick={onClose}>
            <IconX />
          </button>
        </div>

        {blocked && (
          <div className="rebase-banner">
            <IconAlert width={14} height={14} />
            {plan?.dirty ? (
              <span>{t("Commit or stash your changes first — the working tree is not clean.")}</span>
            ) : (
              <span>The range contains merge commits ({merges.join(', ')}); flattening them would lose history.</span>
            )}
          </div>
        )}
        {!blocked && plan?.pushed && (
          <div className="rebase-banner rebase-banner-warn">
            <IconAlert width={14} height={14} />
            <span>
              These commits are already on {plan.upstream}; rewriting them means the next push needs a force-push.
            </span>
          </div>
        )}
        {!loading && badFirst && (
          <div className="rebase-banner">
            <IconAlert width={14} height={14} />
            <span>{t("The first commit cannot be squashed or fixed up.")}</span>
          </div>
        )}

        <div className="modal-body no-pad">
          {loading ? (
            <div className="list-empty">{t("Loading commits…")}</div>
          ) : rows.length === 0 ? (
            <div className="list-empty">{t("Nothing to rebase above this commit.")}</div>
          ) : (
            <div className="rebase-list">
              <div className="rebase-hint">{t("Applied top to bottom — the top row is the oldest commit.")}</div>
              {rows.map((row, index) => (
                <div className={`rebase-row${row.action === 'drop' ? ' is-dropped' : ''}`} key={row.hash}>
                  <select
                    className="rebase-action"
                    aria-label={`Action for ${shortHash(row.hash)}`}
                    value={row.action}
                    onChange={(e) => setAction(index, e.target.value as Action)}
                  >
                    {ACTIONS.map((action) => (
                      <option key={action} value={action}>{action}</option>
                    ))}
                  </select>
                  <span className="rebase-hash">{shortHash(row.hash)}</span>
                  <span className="rebase-subject">
                    <span className="truncate" title={row.subject}>{row.subject}</span>
                    <span className="rebase-author">{row.authorName}</span>
                    {(row.action === 'reword' || row.action === 'squash' || row.action === 'fixup') && (
                      <input
                        className="rebase-message"
                        aria-label={`Message for ${shortHash(row.hash)}`}
                        value={row.message}
                        onChange={(e) => setMessage(index, e.target.value)}
                        placeholder={row.action === 'reword' ? 'New commit message' : 'Optional (git keeps the combined message)'}
                      />
                    )}
                  </span>
                  <span className="rebase-move">
                    <button
                      type="button"
                      className="icon-btn"
                      title="Move earlier"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      title="Move later"
                      disabled={index === rows.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      ↓
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <span className="repo-panel-count">
            {t(`${rows.filter((row) => row.action !== 'drop').length} of ${rows.length} commits`)} kept
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={onClose} disabled={saving}>{t("Cancel")}</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={loading || saving || blocked || badFirst || rewordMissing || rows.length === 0}
            onClick={() => void start()}
            title={rewordMissing ? 'Every reword needs a message' : undefined}
          >
            {saving ? 'Rebasing…' : 'Start rebase'}
          </button>
        </div>
      </div>
    </div>
  );
}
