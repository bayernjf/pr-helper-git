import type { CiHealthReport } from '../types';
import { request } from './core';

/** Read-only CI health snapshot. The PAT is forwarded only when present. */
export function fetchCiHealth(pat: string, days: number, refresh = false): Promise<CiHealthReport> {
  const query = new URLSearchParams({
    days: String(days),
    ...(refresh ? { refresh: '1' } : {}),
  });
  return request(`/api/ci-health?${query}`, {
    headers: pat ? { 'x-github-pat': pat } : undefined,
  }) as Promise<CiHealthReport>;
}
