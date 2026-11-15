// Flow preflight (P3-13): read-only checks for app access, branches, PR
// mergeability, upstream dependencies, Actions and GitHub Environments.
// The server returns findings with fix suggestions; this modal only groups
// and presents them. Nothing here mutates the workflow.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchFlowPreflight, type FlowPreflightFinding, type FlowPreflightResult } from '../api/flows';
import { errorMessage } from '../lib/errors';
import { useEscape } from '../hooks/use-escape';
import { t, tp } from '../i18n';
import { IconX } from './icons';

const CATEGORY_ORDER: FlowPreflightFinding['category'][] = [
  'app', 'branch', 'pr', 'dependency', 'actions', 'environment',
];

const CATEGORY_LABEL: Record<FlowPreflightFinding['category'], string> = {
  app: 'GitHub App access',
  branch: 'Branches',
  pr: 'Pull requests',
  dependency: 'Upstream dependencies',
  actions: 'Actions',
  environment: 'GitHub Environments',
};

const STATUS_LABEL: Record<FlowPreflightFinding['status'], string> = {
  pass: 'pass',
  warn: 'warning',
  fail: 'failed',
  skip: 'skipped',
};

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

  const grouped = useMemo(() => CATEGORY_ORDER.map((category) => ({
    category,
    findings: (result?.findings ?? []).filter((finding) => finding.category === category),
  })).filter((group) => group.findings.length > 0), [result]);

  const counts = useMemo(() => {
    const findings = result?.findings ?? [];
    return {
      fail: findings.filter((finding) => finding.status === 'fail').length,
      warn: findings.filter((finding) => finding.status === 'warn').length,
      pass: findings.filter((finding) => finding.status === 'pass').length,
    };
  }, [result]);

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
          {!loading && result ? (
            <>
              <div className="preflight-summary">
                <span className={result.ok ? 'ok' : 'warn'}>
                  {result.ok ? t('No blocking issues found') : t('Blocking issues found')}
                </span>
                <span>{tp('{count} failed', { count: counts.fail })}</span>
                <span>{tp('{count} warnings', { count: counts.warn })}</span>
                <span>{tp('{count} passed', { count: counts.pass })}</span>
                <span className="preflight-checked">{t('Checked')}: {new Date(result.checkedAt).toLocaleString('zh-CN')}</span>
              </div>
              {grouped.map((group) => (
                <section key={group.category} className="preflight-group">
                  <h3>{t(CATEGORY_LABEL[group.category])}</h3>
                  {group.findings.map((finding, index) => (
                    <article className={`preflight-finding is-${finding.status}`} key={`${finding.category}-${finding.code}-${index}`}>
                      <div className="preflight-finding-head">
                        <b>{finding.title}</b>
                        <span className={`preflight-status is-${finding.status}`}>{t(STATUS_LABEL[finding.status])}</span>
                      </div>
                      <p>{finding.detail}</p>
                      {finding.suggestion ? <p className="preflight-suggestion">{t('Fix')}: {finding.suggestion}</p> : null}
                    </article>
                  ))}
                </section>
              ))}
            </>
          ) : null}
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
