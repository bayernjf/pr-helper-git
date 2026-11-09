import { useEffect, useMemo, useRef, useState } from 'react';
import { getCompare, type CompareResult } from '../api';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import { shortHash } from '../lib/format';
import { IconX } from './icons';
import { Dropdown } from './Dropdown';
import { t, tp } from '../i18n';

type Tab = 'commits' | 'files';

function statusColor(status: string): string {
  if (status.startsWith('A')) return 'var(--green)';
  if (status.startsWith('D')) return 'var(--red)';
  if (status.startsWith('R') || status.startsWith('C')) return 'var(--cyan)';
  return 'var(--yellow)';
}

export default function CompareModal({ onClose }: { onClose: () => void }) {
  const { activeRepo, refs, status } = useApp();
  useEscape(onClose);
  const options = useMemo(
    () => refs.filter((r) => !r.name.startsWith('refs/stash')).map((r) => r.shortName),
    [refs],
  );
  const current = status?.branch || options[0] || '';
  const [base, setBase] = useState(current);
  const [head, setHead] = useState(options.find((o) => o !== current) || current);
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
    } catch (err: any) {
      if (seq !== seqRef.current) return;
      setError(err.message);
      setResult(null);
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }

  // Auto-compare once on mount with the default refs.
  useEffect(() => { run(base, head); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t("Compare references")}</h2>
          <button type="button" className="icon-btn" aria-label={t("Close")} title={t("Close")} onClick={onClose}><IconX /></button>
        </div>
        <div className="compare-picker">
          <div className="compare-field">
            <label>{t("Base")}</label>
            <Dropdown value={base} onChange={setBase} options={options.map((o) => ({ value: o, label: o }))} />
          </div>
          <span className="compare-arrow">→</span>
          <div className="compare-field">
            <label>{t("Head")}</label>
            <Dropdown value={head} onChange={setHead} options={options.map((o) => ({ value: o, label: o }))} />
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={loading || !base || !head || base === head}
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
              </div>
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
                    <div className="detail-label">{tp("In “{head}” but not “{base}”", { head, base })}</div>
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
                      {tp("In “{base}” but not “{head}”", { head, base })}
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
                  result.files.map((f) => (
                    <div key={f.path} className="compare-commit">
                      <span style={{ color: statusColor(f.status), width: 18 }}>{f.status.slice(0, 1)}</span>
                      <span className="compare-subject">{f.path}</span>
                      <span className="changes-stats">
                        <span className="add">+{f.additions}</span>
                        <span className="del">-{f.deletions}</span>
                      </span>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
