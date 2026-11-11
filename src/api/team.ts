import { post, request } from './core';

// ---------- team identity ----------

export interface Me {
  name: string;
  role: 'admin' | 'member';
  instance: boolean;
}

export interface TeamMember {
  name: string;
  role: 'admin' | 'member';
  createdAt: string | null;
}

export interface TeamConfig {
  version: number;
  exportedAt: string;
  repos: string[];
  owner: string;
  members: Array<{ name: string; role: 'admin' | 'member' }>;
}

export const getMe = () => request<Me>('/api/me');

export const getTeam = () =>
  request<{ owner: Me; users: TeamMember[] }>('/api/users');

export const createTeamUser = (name: string, role: 'admin' | 'member') =>
  post('/api/users', { name, role }) as Promise<{ user: TeamMember; token: string }>;

export const removeTeamUser = (name: string) =>
  request<{ ok: boolean; name: string }>('/api/users', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });

export const getTeamConfig = () => request<TeamConfig>('/api/team/config');

export const importTeamConfig = (payload: { repos: string[]; mode?: 'replace' | 'merge' }) =>
  post('/api/team/config', payload) as Promise<{ ok: boolean; repos: string[]; imported: number }>;

// ---------- server-side PAT storage ----------
// The token lives in ~/.pr-helper-git/config.json (0700 directory, 0600 file)
// and never round-trips to the browser. Proxy routes inject it server-side for
// the owner only; members must send their own PAT.

export const getPatStatus = () =>
  request<{ hasServerPat: boolean }>(`/api/pat/status`);
export const storeServerPat = (pat: string) =>
  post('/api/pat', { pat }) as Promise<{ hasServerPat: boolean }>;
export const deleteServerPat = () =>
  request<{ hasServerPat: boolean }>(`/api/pat`, { method: 'DELETE' });
