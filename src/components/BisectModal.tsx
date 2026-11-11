import { errorMessage } from '../lib/errors';
// Bisect wizard: wraps git bisect start / good|bad / reset. Every action goes
// through the server so audit logging and repo registration checks apply.
import { useEffect, useState } from 'react';
import {
  getBisectState,
  markBisect,
  resetBisect,
  startBisect,
  type BisectState,
} from '../api';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import { shortHash } from '../lib/format';
import { IconX } from './icons';
import { t } from '../i18n';

export default function BisectModal({ onClose }: { onClose: () => void }) {
  const { activeRepo, commits, toast, refresh } = useApp();
  const [state, setState] = useState<BisectState | null>(null);
  const [good, setGood] = useState('');
  const [bad, setBad] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEscape(onClose);

  useEffect(() => {
    if (!activeRepo) return;
    let cancelled = false;
    getBisectState(activeRepo)
      .then((res) => { if (!cancelled) setState(res); })
      .catch((err) => { if (!cancelled) toast(errorMessage(err), 'error'); });
    return () => { cancelled = true; };
  }, [activeRepo, toast]);

  // Prefill with the ends of the loaded history: newest as bad, oldest as good.
  useEffect(() => {
    if (commits.length === 0) return;
    setBad((prev) => prev || commits[0].hash);
    setGood((prev) => prev || commits[commits.length - 1].hash);
  }, [commits]);

  async function run(fn: () => Promise<{ message: string; state: BisectState }>) {
    setBusy(true);
    try {
      const res = await fn();
      setState(res.state);
      setMessage(res.message);
      refresh();
    } catch (err) {
      toast(errorMessage(err) || 'bisect action failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  const active = state?.active === true;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t('Bisect')}</h2>
          <button type="button" className="icon-btn" aria-label={t('Close')} title={t('Close')} onClick={onClose}>
            <IconX />
          </button>
        </div>
        <div className="modal-body">
          {!state && <div className="list-empty">{t('Loading…')}</div>}

          {state && !active && (
            <>
              <div className="form-group">
                <label>{t('Good commit')}</label>
                <input value={good} onChange={(e) => setGood(e.target.value.trim())} placeholder="<sha>" />
              </div>
              <div className="form-group">
                <label>{t('Bad commit')}</label>
                <input value={bad} onChange={(e) => setBad(e.target.value.trim())} placeholder="<sha>" />
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                {t('Bisect moves HEAD onto candidate commits and restores the starting branch on reset.')}
              </div>
            </>
          )}

          {state && active && (
            <>
              <div className="detail-section">
                <span className="detail-label">{t('Started from')}</span>
                <div className="detail-value">{state.start || t('detached HEAD')}</div>
              </div>
              <div className="detail-section">
                <span className="detail-label">{t('Current commit')}</span>
                <div className="detail-value">
                  {state.current ? `${shortHash(state.current.sha)} ${state.current.subject}` : '—'}
                </div>
              </div>
              <div className="detail-section">
                <span className="detail-label">{t('Decisions')}</span>
                <div className="detail-value muted">
                  {`${t('good')}: ${state.decisions.good} · ${t('bad')}: ${state.decisions.bad}`}
                </div>
              </div>
            </>
          )}

          {message && (
            <pre className="bisect-log">{message}</pre>
          )}
        </div>
        <div className="modal-footer">
          {!active && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !good || !bad || good === bad || !activeRepo}
              onClick={() => activeRepo && run(() => startBisect(activeRepo, good, bad))}
            >
              {t('Start bisect')}
            </button>
          )}
          {active && (
            <>
              <button type="button" className="btn" disabled={busy} onClick={() => activeRepo && run(() => markBisect(activeRepo, 'good'))}>
                {t('Mark good')}
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => activeRepo && run(() => markBisect(activeRepo, 'bad'))}>
                {t('Mark bad')}
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => activeRepo && run(() => resetBisect(activeRepo))}>
                {t('Reset bisect')}
              </button>
            </>
          )}
          <button type="button" className="btn" onClick={onClose}>{t('Close')}</button>
        </div>
      </div>
    </div>
  );
}
