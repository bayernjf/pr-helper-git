// Gate disclosure (old ui/format.ts gateDisclosure + checkDetailsMarkup):
// a gate summary chip that expands into the per-check breakdown grouped by
// source once a live read provides details; without details it stays the
// plain chip, exactly like the original's no-details branch.
import { deploymentSummaryForTarget, type GitHubCheckDetail } from '../lib/domain';
import { t } from '../i18n';

const STATE_LABEL: Record<GitHubCheckDetail['state'], string> = {
  success: 'passed',
  failure: 'failed',
  pending: 'running',
};

export default function GateDisclosure({ summary, details, target, className }: {
  summary: string;
  details: readonly GitHubCheckDetail[] | null;
  target?: string;
  className?: string;
}) {
  if (!details?.length) return <span className={className}>{summary}</span>;
  const groups = [...new Set(details.map((detail) => detail.source))];
  return (
    <details className={`gate-disclosure${className ? ` ${className}` : ''}`}>
      <summary>{summary}</summary>
      <div className="check-detail-groups">
        {groups.map((source) => (
          <section key={source} className="check-source">
            <strong>{source}</strong>
            {details.filter((detail) => detail.source === source).map((detail, index) => {
              const note = deploymentSummaryForTarget(detail.summary, detail.source, target ?? '');
              return (
                <a
                  key={index}
                  className={`check-detail ${detail.state}`}
                  href={detail.url ?? undefined}
                  target={detail.url ? '_blank' : undefined}
                  rel="noreferrer"
                >
                  <span className="check-detail-icon" aria-hidden="true">
                    {detail.state === 'success' ? '✓' : detail.state === 'failure' ? '×' : '…'}
                  </span>
                  <span>
                    <b>{detail.name}</b>
                    {note ? <small className="check-detail-summary">{note}</small> : null}
                  </span>
                  <small>{t(STATE_LABEL[detail.state])}</small>
                </a>
              );
            })}
          </section>
        ))}
      </div>
    </details>
  );
}