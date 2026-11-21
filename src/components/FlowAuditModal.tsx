// Flow operation audit (P3-14): read-only table + client-side CSV export.
// This is separate from AuditModal, which shows the Git command audit; the
// control-tower operations live in workflow_operation_audit_logs.
import { useEffect, useMemo, useState } from 'react';
import { fetchFlowAudit, type FlowAuditEntry } from '../api/flows';
import { flowAuditCsv, flowAuditSummary } from '../lib/automation/flow-audit';
import { useEscape } from '../hooks/use-escape';
import { useToast } from './ui';
import { errorMessage } from '../lib/errors';
import { t, tp } from '../i18n';
import { IconX } from './icons';

const LOAD_LIMIT = 500;

function downloadCsv(csv: string) {
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `pr-helper-flows-audit-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke on the next task so Safari/Firefox have time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function FlowAuditModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [entries, setEntries] = useState<FlowAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  useEscape(onClose);

  useEffect(() => {
    let cancelled = false;
    fetchFlowAudit(LOAD_LIMIT)
      .then((result) => { if (!cancelled) setEntries(result.entries); })
      .catch((err) => { if (!cancelled) toast.error(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [toast]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) => [
      entry.action, entry.outcome, entry.repository, entry.workflowId,
      entry.stageId, entry.source, entry.target, entry.failureReason,
    ].some((value) => String(value ?? '').toLowerCase().includes(needle)));
  }, [entries, query]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal modal-wide" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2>{t('Flows audit log')}</h2>
          <button type="button" className="icon-btn" aria-label={t('Close')} title={t('Close')} onClick={onClose}><IconX /></button>
        </div>
        <div className="modal-body no-pad flow-audit-body">
          <div className="flow-audit-toolbar">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('Filter audit entries')}
              aria-label={t('Filter audit entries')}
            />
            <span>{tp('{count} entries', { count: visible.length })}</span>
            <button
              type="button"
              className="drawer-btn"
              disabled={!visible.length}
              onClick={() => downloadCsv(flowAuditCsv(visible))}
            >
              {t('Export CSV')}
            </button>
          </div>
          {loading ? <p className="compact-notice">{t('Loading…')}</p> : null}
          {!loading && !visible.length ? <p className="compact-notice">{t('No audit entries yet')}</p> : null}
          {visible.length ? (
            <table className="flow-audit-table">
              <thead>
                <tr>
                  <th>{t('Time')}</th>
                  <th>{t('Action')}</th>
                  <th>{t('Outcome')}</th>
                  <th>{t('Details')}</th>
                  <th>{t('Failure')}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((entry) => (
                  <tr key={`${entry.id}-${entry.occurredAt}`}>
                    <td>{new Date(entry.occurredAt).toLocaleString('zh-CN')}</td>
                    <td><code>{entry.action}</code></td>
                    <td className={entry.outcome === 'success' ? 'ok' : 'warn'}>{entry.outcome}</td>
                    <td>{flowAuditSummary(entry)}</td>
                    <td>{entry.failureReason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      </div>
    </div>
  );
}
