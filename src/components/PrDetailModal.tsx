import { useEffect, useState } from 'react';
import { githubProxy } from '../api';
import { useApp } from '../app-state';
import { formatFullDate } from '../lib/format';
import type { CheckRun, PullRequest } from '../types';
import { useConfirm, useToast } from './ui';

type MergeMethod = 'merge' | 'squash' | 'rebase';

export default function PrDetailModal({
  pr,
  onClose,
  onChanged,
}: {
  pr: PullRequest;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { pat, remote } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const [checks, setChecks] = useState<CheckRun[]>([]);
  const [method, setMethod] = useState<MergeMethod>('squash');
  const [working, setWorking] = useState(false);

  const base = `/repos/${remote!.owner}/${remote!.repo}`;

  useEffect(() => {
    let cancelled = false;
    githubProxy<{ check_runs: CheckRun[] }>(
      pat,
      `${base}/commits/${pr.head.sha}/check-runs`,
    )
      .then((res) => {
        if (!cancelled) setChecks(res.data?.check_runs || []);
      })
      .catch(() => {
        if (!cancelled) setChecks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [pat, base, pr.head.sha]);

  async function merge() {
    const ok = await confirm(
      `Merge PR #${pr.number} using ${method}?`,
      'GitHub enforces branch protection and required reviews; any rejection is shown as-is.',
    );
    if (!ok) return;
    setWorking(true);
    try {
      await githubProxy(pat, `${base}/pulls/${pr.number}/merge`, 'POST', { merge_method: method });
      toast.notify('Pull request merged', 'success');
      onChanged();
    } catch (err: any) {
      toast.error(err.detail ? `${err.message}: ${err.detail}` : err.message);
      setWorking(false);
    }
  }

  async function changeState(state: 'open' | 'closed') {
    const ok = await confirm(state === 'closed' ? `Close PR #${pr.number}?` : `Reopen PR #${pr.number}?`);
    if (!ok) return;
    setWorking(true);
    try {
      await githubProxy(pat, `${base}/pulls/${pr.number}`, 'PATCH', { state });
      toast.notify(state === 'closed' ? 'Pull request closed' : 'Pull request reopened', 'success');
      onChanged();
    } catch (err: any) {
      toast.error(err.message);
      setWorking(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>#{pr.number} {pr.title}</h3>
        <p className="modal-detail">
          {pr.head.label} → {pr.base.label} · opened by {pr.user.login} on{' '}
          {formatFullDate(pr.created_at)}
        </p>

        <div className="detail-label">Checks</div>
        {checks.length === 0 ? (
          <p className="modal-detail">No check runs reported.</p>
        ) : (
          checks.map((c) => (
            <div key={c.id} className="pr-checks">
              <span
                className={`check-dot ${
                  c.conclusion === 'success'
                    ? 'success'
                    : c.conclusion === null
                      ? 'pending'
                      : 'failure'
                }`}
              />
              <span>{c.name}</span>
              <span className="modal-detail">
                {c.conclusion || c.status}
              </span>
            </div>
          ))
        )}

        <div className="modal-actions">
          <a className="btn" href={pr.html_url} target="_blank" rel="noreferrer">
            Open on GitHub
          </a>
          {pr.state === 'open' ? (
            <>
              <select
                className="input"
                style={{ width: 'auto' }}
                value={method}
                onChange={(e) => setMethod(e.target.value as MergeMethod)}
              >
                <option value="squash">squash</option>
                <option value="merge">merge commit</option>
                <option value="rebase">rebase</option>
              </select>
              <button
                type="button"
                className="btn"
                disabled={working}
                onClick={() => changeState('closed')}
              >
                Close
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={working}
                onClick={merge}
              >
                Merge
              </button>
            </>
          ) : (
            !pr.merged && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={working}
                onClick={() => changeState('open')}
              >
                Reopen
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
