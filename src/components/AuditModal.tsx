import { useEffect, useState } from 'react';
import { getAudit } from '../api';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import { formatFullDate } from '../lib/format';
import type { AuditEntry } from '../types';
import { IconX } from './icons';

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
          <h2>Audit log</h2>
          <button type="button" className="icon-btn" aria-label="Close" title="Close" onClick={onClose}><IconX /></button>
        </div>
        <div className="modal-body no-pad">
          {loading ? (
            <div className="list-empty">Loading audit trail…</div>
          ) : total === 0 ? (
            <div className="list-empty">
              {filtersActive
                ? 'No entries match the current filters.'
                : 'No audit entries recorded yet.'}
            </div>
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
                Showing {entries.length} of {total} matching entries, newest first.
                {total > entries.length ? ` First ${LOAD_LIMIT} loaded.` : ''}
              </div>
              {entries.map((entry, i) => {
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
