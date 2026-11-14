// Flow operation audit projection and CSV export (P3-14 / M-F14).
// The server returns workflow_operation_audit_logs rows in newest-first
// order; the UI only formats them, so this module stays pure and testable.
import type { FlowAuditEntry } from '../../api/flows';

const HEADER = [
  'occurredAt',
  'action',
  'outcome',
  'repository',
  'workflowId',
  'stageId',
  'source',
  'target',
  'pullNumber',
  'runId',
  'failureReason',
  'metadata',
] as const;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** RFC 4180-style CSV with a fixed header. Metadata is compact JSON. */
export function flowAuditCsv(entries: readonly FlowAuditEntry[]): string {
  const rows = entries.map((entry) => [
    entry.occurredAt,
    entry.action,
    entry.outcome,
    entry.repository,
    entry.workflowId,
    entry.stageId,
    entry.source,
    entry.target,
    entry.pullNumber,
    entry.runId,
    entry.failureReason,
    Object.keys(entry.metadata ?? {}).length ? JSON.stringify(entry.metadata) : '',
  ].map(csvCell).join(','));
  return [HEADER.join(','), ...rows].join('\r\n');
}

/** One-line detail for the audit table, without dumping raw metadata. */
export function flowAuditSummary(entry: FlowAuditEntry): string {
  const parts: string[] = [];
  if (entry.repository) parts.push(entry.repository);
  if (entry.stageId) parts.push(entry.stageId);
  if (entry.pullNumber) parts.push(`#${entry.pullNumber}`);
  if (entry.runId) parts.push(`run ${entry.runId}`);
  return parts.join(' · ') || '—';
}
