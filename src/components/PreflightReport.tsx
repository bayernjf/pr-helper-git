// Shared preflight presentation: the summary line and the category-grouped
// findings with fix hints. Used by the per-flow modal and the board aggregate.
import { useMemo } from 'react';
import type { FlowPreflightFinding, FlowPreflightResult } from '../api/flows';
import { t, tp } from '../i18n';

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

export default function PreflightReport({ result }: { result: FlowPreflightResult }) {
  const grouped = useMemo(() => CATEGORY_ORDER.map((category) => ({
    category,
    findings: result.findings.filter((finding) => finding.category === category),
  })).filter((group) => group.findings.length > 0), [result]);

  const counts = useMemo(() => ({
    fail: result.findings.filter((finding) => finding.status === 'fail').length,
    warn: result.findings.filter((finding) => finding.status === 'warn').length,
    pass: result.findings.filter((finding) => finding.status === 'pass').length,
  }), [result]);

  return (
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
  );
}