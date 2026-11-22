// Board-level preflight aggregate (the old overview preflightPanel): one
// read-only run across every active flow, a totals badge, and per-flow
// reports that open on the blocking lanes. Fail-soft: a flow the server
// could not check is listed with its error instead of sinking the panel.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchBoardPreflight, type BoardPreflightPayload } from '../api/flows';
import { aggregateBoardPreflight } from '../lib/automation/preflight-aggregate';
import type { Workflow } from '../lib/automation/workflow';
import { errorMessage } from '../lib/errors';
import { useEscape } from '../hooks/use-escape';
import { t, tp } from '../i18n';
import { IconX } from './icons';
import PreflightReport from './PreflightReport';

export default function BoardPreflightModal({ workflows, onClose, inline = false }: {
  workflows: readonly Workflow[];
  onClose: () => void;
  inline?: boolean;
}) {
  const [payload, setPayload] = useState<BoardPreflightPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEscape(onClose);

  const run = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setPayload(await fetchBoardPreflight());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void run(); }, [run]);

  const summary = useMemo(
    () => aggregateBoardPreflight(payload?.results ?? [], payload?.errors ?? []),
    [payload],
  );
  const nameFor = (workflowId: string) => workflows.find((workflow) => workflow.id === workflowId)?.name ?? workflowId;

  const panel = (
    <>
        <div className="modal-header">
          <div>
            <h2>{t('Board preflight')}</h2>
            <p className="modal-subtitle">{t('Read-only check across every active flow')}</p>
          </div>
          <button type="button" className="icon-btn" aria-label={t('Close')} onClick={onClose}><IconX /></button>
        </div>
        <div className="modal-body flow-preflight-body">
          {loading ? <p className="compact-notice">{t('Checking all flows…')}</p> : null}
          {error ? <div className="compact-notice is-error"><p>{error}</p></div> : null}
          {!loading && payload ? (
            payload.results.length === 0 && payload.errors.length === 0 ? (
              <p className="drawer-empty">{t('No active flows to check')}</p>
            ) : (
              <>
                <div className="preflight-summary">
                  <span className={summary.ok ? 'ok' : 'warn'}>
                    {summary.ok ? t('All flows pass preflight') : t('Blocking issues found')}
                  </span>
                  <span>{tp('{count} failed', { count: summary.totals.fail })}</span>
                  <span>{tp('{count} warnings', { count: summary.totals.warn })}</span>
                  <span>{tp('{count} passed', { count: summary.totals.pass })}</span>
                  <span>{tp('{count} flow(s) checked', { count: payload.results.length })}</span>
                </div>
                {payload.errors.length ? (
                  <div className="compact-notice is-error">
                    <p>{t('Some flows could not be checked')}</p>
                    {payload.errors.map((entry) => (
                      <p key={entry.workflowId}>{nameFor(entry.workflowId)}: {entry.message}</p>
                    ))}
                  </div>
                ) : null}
                {payload.results.map((result) => (
                  <details key={result.workflowId} className="board-preflight-flow" open={!result.ok}>
                    <summary>
                      <b>{nameFor(result.workflowId)}</b>
                      <small>{result.repository}</small>
                      <span className={result.ok ? 'ok' : 'warn'}>
                        {result.ok ? t('pass') : t('Blocking issues found')}
                      </span>
                    </summary>
                    <PreflightReport result={result} />
                  </details>
                ))}
              </>
            )
          ) : null}
        </div>
        <div className="modal-footer">
          <span className="preflight-readonly">{t('Read-only check — the flow is not modified.')}</span>
          <button type="button" className="drawer-btn" onClick={() => void run()} disabled={loading}>
            {loading ? t('Checking all flows…') : t('Run again')}
          </button>
          <button type="button" className="drawer-btn primary" onClick={onClose}>{t('Close')}</button>
        </div>
    </>
  );
  if (inline) {
    return <section className="flow-preflight-panel" aria-label={t('Board preflight')}>{panel}</section>;
  }
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal modal-wide flow-preflight-modal" onClick={(event) => event.stopPropagation()}>
        {panel}
      </div>
    </div>
  );
}
