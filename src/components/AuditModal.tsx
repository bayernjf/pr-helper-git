import { useEffect, useState } from 'react';
import { getAudit } from '../api';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import { formatFullDate } from '../lib/format';
import type { AuditEntry } from '../types';
import { IconX } from './icons';
import { Dropdown } from './Dropdown';
import { auditAction, t, tp } from '../i18n';

type OutcomeFilter = 'all' | 'ok' | 'fail';

const LOAD_LIMIT = 1000;
const DEBOUNCE_MS = 300;

const SHOWN_KEYS = new Set(['at', 'ok', 'action', 'repo', 'method', 'path', 'number']);

// One-line human-readable summary built from the common identifying fields.
function summarize(entry: AuditEntry): string {
  const parts: string[] = [];
  if (entry.method) parts.push(entry.method);
  if (entry.path) parts.push(entry.path);
  if (entry.repo) {
    const segments = String(entry.repo).split('/');
    parts.push(`repo:${segments[segments.length - 1]}`);
  }
  if (typeof entry.number === 'number') parts.push(`#${entry.number}`);
  return parts.join(' ');
}

function extraFields(entry: AuditEntry): string | null {
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (!SHOWN_KEYS.has(key)) rest[key] = value;
  }
  return Object.keys(rest).length ? JSON.stringify(rest, null, 2) : null;
}

export default function AuditModal({ onClose }: { onClose: () => void }) {
  const { toast } = useApp();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [textFilter, setTextFilter] = useState('');
  const [outcome, setOutcome] = useState<OutcomeFilter>('all');
  useEscape(onClose);

  const filtersActive = textFilter.trim() !== '' || outcome !== 'all';

  // Filtering runs on the server over the whole retained file. The text input
  // is debounced so typing does not fire a request per keystroke; the outcome
  // select changes immediately. The cancellation flag protects against stale
  // responses from an earlier filter state.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      getAudit(LOAD_LIMIT, { q: textFilter, outcome })
        .then((res) => {
          if (cancelled) return;
          setEntries(res.entries);
          setTotal(res.total);
        })
        .catch((err) => { if (!cancelled) toast(err.message, 'error'); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, textFilter ? DEBOUNCE_MS : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [textFilter, outcome, toast]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t("Audit log")}</h2>
          <button type="button" className="icon-btn" aria-label={t("Close")} title={t("Close")} onClick={onClose}><IconX /></button>
        </div>
        <div className="modal-body no-pad">
          {loading ? (
            <div className="list-empty">{t("Loading audit trail…")}</div>
          ) : (
            <div className="audit-list">
              {/* Filters stay visible even when nothing matches, otherwise a
                  zero-result filter would hide the control needed to undo it. */}
              <div className="audit-filters">
                <input
                  type="text"
                  value={textFilter}
                  placeholder={t("Filter by action or summary…")}
                  spellCheck={false}
                  onChange={(e) => setTextFilter(e.target.value)}
                />
                <Dropdown
                value={outcome}
                onChange={(v) => setOutcome(v as OutcomeFilter)}
                options={[
                  { value: 'all', label: t('All outcomes') },
                  { value: 'ok', label: t('Success only') },
                  { value: 'fail', label: t('Failures only') },
                ]}
              />
              </div>
              {total === 0 ? (
                <div className="list-empty">
                  {filtersActive
                    ? t('No entries match the current filters.')
                    : t('No audit entries recorded yet.')}
                </div>
              ) : (
                <>
                  <div className="audit-meta">
                    {tp('Showing {shown} of {total} matching entries, newest first.', { shown: entries.length, total })}
                    {total > entries.length ? tp(' First {limit} loaded.', { limit: LOAD_LIMIT }) : ''}
                  </div>
                  {entries.map((entry, i) => {
                    const extra = extraFields(entry);
                    return (
                      <div className="audit-item" key={`${entry.at}-${i}`}>
                        <span className={`audit-ok ${entry.ok === false ? 'is-fail' : 'is-ok'}`}>
                          {entry.ok === false ? '!' : '✓'}
                        </span>
                        <span className="audit-time">{formatFullDate(entry.at)}</span>
                        <span className="audit-action">{entry.action ? auditAction(entry.action) : t('unknown')}</span>
                        <span className="audit-summary">{summarize(entry)}</span>
                        {extra && (
                          <details className="audit-raw">
                            <summary>{t("raw")}</summary>
                            <pre>{extra}</pre>
                          </details>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>{t("Close")}</button>
        </div>
      </div>
    </div>
  );
}
