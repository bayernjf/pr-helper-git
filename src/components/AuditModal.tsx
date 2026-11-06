import { useEffect, useMemo, useState } from 'react';
import { getAudit } from '../api';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import { formatFullDate } from '../lib/format';
import type { AuditEntry } from '../types';
import { IconX } from './icons';

type OutcomeFilter = 'all' | 'ok' | 'fail';

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

  // Client-side filtering over the loaded window. The free-text query matches
  // the action name and the rendered summary (case-insensitive); the outcome
  // select narrows to successes or recorded failures.
  const visible = useMemo(() => {
    const needle = textFilter.trim().toLowerCase();
    return entries.filter((entry) => {
      if (outcome === 'ok' && entry.ok === false) return false;
      if (outcome === 'fail' && entry.ok !== false) return false;
      if (!needle) return true;
      const haystack = `${entry.action || ''} ${summarize(entry)}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [entries, textFilter, outcome]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAudit(200)
      .then((res) => {
        if (!cancelled) {
          setEntries(res.entries);
          setTotal(res.total);
        }
      })
      .catch((err) => { if (!cancelled) toast(err.message, 'error'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [toast]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Audit log</h2>
          <button type="button" className="icon-btn" onClick={onClose}><IconX /></button>
        </div>
        <div className="modal-body no-pad">
          {loading ? (
            <div className="list-empty">Loading audit trail…</div>
          ) : entries.length === 0 ? (
            <div className="list-empty">No audit entries recorded yet.</div>
          ) : (
            <div className="audit-list">
              <div className="audit-filters">
                <input
                  type="text"
                  value={textFilter}
                  placeholder="Filter by action or summary…"
                  spellCheck={false}
                  onChange={(e) => setTextFilter(e.target.value)}
                />
                <select value={outcome} onChange={(e) => setOutcome(e.target.value as OutcomeFilter)}>
                  <option value="all">All outcomes</option>
                  <option value="ok">Success only</option>
                  <option value="fail">Failures only</option>
                </select>
              </div>
              <div className="audit-meta">
                Showing {visible.length} of {entries.length} loaded
                ({total} parsed entries total), newest first.
              </div>
              {visible.length === 0 ? (
                <div className="list-empty">No entries match the current filters.</div>
              ) : visible.map((entry, i) => {
                const extra = extraFields(entry);
                return (
                  <div className="audit-item" key={`${entry.at}-${i}`}>
                    <span className={`audit-ok ${entry.ok === false ? 'is-fail' : 'is-ok'}`}>
                      {entry.ok === false ? '!' : '✓'}
                    </span>
                    <span className="audit-time">{formatFullDate(entry.at)}</span>
                    <span className="audit-action">{entry.action || 'unknown'}</span>
                    <span className="audit-summary">{summarize(entry)}</span>
                    {extra && (
                      <details className="audit-raw">
                        <summary>raw</summary>
                        <pre>{extra}</pre>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
