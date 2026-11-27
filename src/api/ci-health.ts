import type { CiHealthReport } from '../types';
import { request } from './core';
import { peekSnapshot, putSnapshot } from './snapshot';

const ciHealthKey = (days: number) => `ci-health:${days}`;

/** Last report for this window, so the page paints before the scan answers. */
export function peekCiHealthSnapshot(days: number): CiHealthReport | null {
  return peekSnapshot<CiHealthReport>(ciHealthKey(days));
}

/** Read-only CI health snapshot. The PAT is forwarded only when present. */
export async function fetchCiHealth(pat: string, days: number, refresh = false): Promise<CiHealthReport> {
  const query = new URLSearchParams({
    days: String(days),
    ...(refresh ? { refresh: '1' } : {}),
  });
  const report = (await request(`/api/ci-health?${query}`, {
    headers: pat ? { 'x-github-pat': pat } : undefined,
  })) as CiHealthReport;
  putSnapshot(ciHealthKey(days), report);
  return report;
}
