import { errorMessage } from '../lib/errors';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getCompare, type CompareResult } from '../api';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import { shortHash } from '../lib/format';
import { IconX } from './icons';
import { RefPicker, type RefPickerOption } from './RefPicker';
import { t, tp } from '../i18n';

type Tab = 'commits' | 'files';

// Must match COMPARE_WORKTREE in server/routes-git-helpers.mjs.
const WORKTREE = ':worktree';

function statusColor(status: string): string {
  if (status.startsWith('A')) return 'var(--green)';
  if (status.startsWith('D')) return 'var(--red)';
  if (status.startsWith('R') || status.startsWith('C')) return 'var(--cyan)';
  return 'var(--yellow)';
}

export default function CompareModal({ onClose }: { onClose: () => void }) {
  const { activeRepo, refs, status, commits } = useApp();
  useEscape(onClose);
  const refNames = useMemo(
    () => refs.filter((r) => !r.name.startsWith('refs/stash')).map((r) => r.shortName),
    [refs],
  );
  const options = useMemo<RefPickerOption[]>(() => [
    {
      value: WORKTREE,
      label: t('Working tree'),
      hint: t('Uncommitted changes'),
      group: t('Working tree'),
    },
    ...refs
      .filter((r) => !r.name.startsWith('refs/stash'))
      .map((r) => ({
        value: r.shortName,
        label: r.shortName,
        hint: shortHash(r.hash),
        group: t('Reference'),
      })),
    ...commits.map((c) => ({
      value: c.hash,
      label: `${shortHash(c.hash)} ${c.subject}`,
      hint: c.authorName,
      group: t('Commit'),
    })),
  ], [refs, commits]);

  const current = status?.branch || refNames[0] || '';
  const [base, setBase] = useState(current);
  const [head, setHead] = useState(refNames.find((o) => o !== current) || current);
  const [tab, setTab] = useState<Tab>('commits');
  const [result, setResult] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const seqRef = useRef(0);

  async function run(b: string, h: string) {
    if (!activeRepo || !b || !h || b === h) return;
    const seq = ++seqRef.current;
    setLoading(true);
    setError('');
    try {
      const res = await getCompare(activeRepo, b, h);
      if (seq !== seqRef.current) return;
      setResult(res);
      // The working tree owns no commits, so both commit lists are empty by
      // construction; land on the tab that actually has content.
      if (res.base === WORKTREE || res.head === WORKTREE) setTab('files');
    } catch (err) {
      if (seq !== seqRef.current) return;
      setError(errorMessage(err));
      setResult(null);
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }

  // Auto-compare once on mount with the default refs.
  useEffect(() => { run(base, head); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  function swap() {
    setBase(head);
    setHead(base);
    run(head, base);
  }

  const sideName = (value: string) => (value === WORKTREE ? t('Working tree') : value);
  const resultWorktree = Boolean(result && (result.base === WORKTREE || result.head === WORKTREE));
  const disabled = loading || !base || !head || base === head;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal modal-wide modal-compare" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t("Compare references")}</h2>
          <button type="button" className="icon-btn" aria-label={t("Close")} title={t("Close")} onClick={onClose}><IconX /></button>
        </div>
        <div className="compare-picker">
          <div className="compare-field">
            <label htmlFor="compare-base">{t("Base")}</label>
            <RefPicker id="compare-base" label={t("Base")} value={base} onChange={setBase} options={options} />
          </div>
          <button
            type="button"
            className="compare-swap"
            title={t("Swap base and head")}
            aria-label={t("Swap base and head")}
            disabled={disabled}
            onClick={swap}
          >
            ⇄
          </button>
          <div className="compare-field">
            <label htmlFor="compare-head">{t("Head")}</label>
            <RefPicker id="compare-head" label={t("Head")} value={head} onChange={setHead} options={options} />
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={disabled}
            onClick={() => run(base, head)}
          >
            {t("Compare")}
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="list-empty">{error}</div>}
          {loading && <div className="list-empty">{t("Comparing…")}</div>}
          {!loading && !error && result && (
            <>
              <div className="compare-summary">
                <span><b>{result.ahead.length}</b> {t("commits in head only")}</span>
                <span><b>{result.behind.length}</b> {t("commits in base only")}</span>
                <span><b>{result.files.length}</b> {t("changed files")}</span>
                {resultWorktree && (
                  <span><b>{result.untracked.length}</b> {t("untracked files")}</span>
                )}
              </div>
              {resultWorktree && (
                <div className="compare-note">
                  {t("The working tree has no commits of its own: the commit lists compare HEAD, and uncommitted changes appear under Files.")}
                </div>
              )}
              <div className="compare-tabs">
                <button
                  type="button"
                  className={tab === 'commits' ? 'active' : ''}
                  onClick={() => setTab('commits')}
                >
                  {t("Commits")}</button>
                <button
                  type="button"
                  className={tab === 'files' ? 'active' : ''}
                  onClick={() => setTab('files')}
                >
                  {t("Files")}</button>
              </div>
              <div className="compare-result">
                {tab === 'commits' ? (
                  <>
                    <div className="detail-label">{tp("In “{head}” but not “{base}”", { head: sideName(result.head), base: sideName(result.base) })}</div>
                    {result.ahead.length === 0
                      ? <div className="list-empty">{t("No commits.")}</div>
                      : result.ahead.map((c) => (
                        <div key={c.hash} className="compare-commit">
                          <span className="reflog-hash">{shortHash(c.hash)}</span>
                          <span className="compare-subject">{c.subject}</span>
                          <span className="muted">{c.authorName}</span>
                        </div>
                      ))}
                    <div className="detail-label" style={{ marginTop: 12 }}>
                      {tp("In “{base}” but not “{head}”", { head: sideName(result.head), base: sideName(result.base) })}
                    </div>
                    {result.behind.length === 0
                      ? <div className="list-empty">{t("No commits.")}</div>
                      : result.behind.map((c) => (
                        <div key={c.hash} className="compare-commit">
                          <span className="reflog-hash">{shortHash(c.hash)}</span>
                          <span className="compare-subject">{c.subject}</span>
                          <span className="muted">{c.authorName}</span>
                        </div>
                      ))}
                  </>
                ) : (
                  <>
                    {result.files.length === 0 && result.untracked.length === 0 && (
                      <div className="list-empty">{t("No file changes.")}</div>
                    )}
                    {result.files.map((f) => (
                      <div key={f.path} className="compare-commit">
                        <span style={{ color: statusColor(f.status), width: 18 }}>{f.status.slice(0, 1)}</span>
                        <span className="compare-subject">{f.renamedFrom ? `${f.renamedFrom} → ${f.path}` : f.path}</span>
                        <span className="changes-stats">
                          <span className="add">+{f.additions}</span>
                          <span className="del">-{f.deletions}</span>
                        </span>
                      </div>
                    ))}
                    {result.untracked.length > 0 && (
                      <>
                        <div className="detail-label" style={{ marginTop: 12 }}>
                          {tp("Untracked files ({count}) — not part of the diff", { count: result.untracked.length })}
                        </div>
                        {result.untracked.map((p) => (
                          <div key={p} className="compare-commit">
                            <span style={{ color: statusColor('?'), width: 18 }}>?</span>
                            <span className="compare-subject">{p}</span>
                          </div>
                        ))}
                      </>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
