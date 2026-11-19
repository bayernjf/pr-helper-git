// Flow preflight (P3-13): read-only checks for app access, branches, PR
// mergeability, upstream dependencies, Actions and GitHub Environments.
// The server returns findings with fix suggestions; this modal only groups
// and presents them. Nothing here mutates the workflow.
import { useCallback, useEffect, useState } from 'react';
import { fetchFlowPreflight, type FlowPreflightResult } from '../api/flows';
import { errorMessage } from '../lib/errors';
import { useEscape } from '../hooks/use-escape';
import { t } from '../i18n';
import { IconX } from './icons';
import PreflightReport from './PreflightReport';

export default function FlowPreflightModal({ flowId, flowName, onClose }: {
  flowId: string;
  flowName: string;
  onClose: () => void;
}) {
  const [result, setResult] = useState<FlowPreflightResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEscape(onClose);

  const run = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const payload = await fetchFlowPreflight(flowId);
      setResult(payload.preflight);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [flowId]);

  useEffect(() => { void run(); }, [run]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal modal-wide flow-preflight-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>{t('Flow preflight')}</h2>
            <p className="modal-subtitle">{flowName}</p>
          </div>
          <button type="button" className="icon-btn" aria-label={t('Close')} title={t('Close')} onClick={onClose}><IconX /></button>
        </div>
        <div className="modal-body flow-preflight-body">
          {loading ? <p className="compact-notice">{t('Checking flow…')}</p> : null}
          {error ? <div className="compact-notice is-error"><p>{error}</p></div> : null}
          {!loading && result ? <PreflightReport result={result} /> : null}
        </div>
        <div className="modal-footer">
          <span className="preflight-readonly">{t('Read-only check — the flow is not modified.')}</span>
          <button type="button" className="drawer-btn" onClick={() => void run()} disabled={loading}>
            {loading ? t('Checking flow…') : t('Run again')}
          </button>
          <button type="button" className="drawer-btn primary" onClick={onClose}>{t('Close')}</button>
        </div>
      </div>
    </div>
  );
}