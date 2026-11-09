// CI check aggregation — pure functions so the rollup logic is unit-testable.
// Mirrors pr-helper-git's src/lib/ci.ts (failure > pending > success).

export interface CheckLike {
  name?: string;
  state?: string;
  status?: string;
  conclusion?: string;
}

export type CiState = 'success' | 'failure' | 'pending' | 'none';

const FAILURE_STATES = new Set(['failure', 'error', 'timed_out', 'action_required', 'cancelled', 'startup_failure']);
const PENDING_STATES = new Set(['pending', 'in_progress', 'queued', 'requested', 'waiting']);

/** Normalize a check-run / commit-status record into a state string. */
function stateOf(check: CheckLike): string {
  const s = String(check.state || check.conclusion || check.status || '').toLowerCase();
  return s;
}

/**
 * Roll check runs + commit statuses for one commit up to a single state.
 * failure beats pending beats success; an empty set is 'none'.
 */
export function aggregateCi(checks: CheckLike[]): CiState {
  let pending = 0;
  let passed = 0;
  for (const check of checks) {
    const s = stateOf(check);
    if (FAILURE_STATES.has(s)) return 'failure';
    if (PENDING_STATES.has(s)) pending += 1;
    else passed += 1;
  }
  if (pending > 0) return 'pending';
  if (checks.length === 0) return 'none';
  return 'success';
}
