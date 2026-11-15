import { post, request } from './core';

export interface GithubAuthStatus {
  configured: boolean;
  appSlug: string | null;
  installUrl: string | null;
  missingEnv: string[];
  connected: boolean;
  login: string | null;
  avatarUrl: string | null;
  githubUserId: number | null;
  connectedAt: string | null;
  expiresAt: string | null;
  expired: boolean;
}

export interface GithubDeviceStart {
  flowId: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export type GithubDevicePollState =
  | 'pending'
  | 'slow_down'
  | 'denied'
  | 'expired'
  | 'error'
  | 'connected';

export interface GithubDevicePoll {
  state: GithubDevicePollState;
  interval?: number;
  login?: string;
  message?: string;
}

export interface GithubInstallation {
  id: number;
  account: string | null;
  targetType: string | null;
  repositorySelection: string | null;
}

export const getGithubAuthStatus = () =>
  request<GithubAuthStatus>('/api/auth/github/status');

export const startGithubDeviceFlow = () =>
  post('/api/auth/github/device/start', {}) as Promise<GithubDeviceStart>;

export const pollGithubDeviceFlow = (flowId: string) =>
  post('/api/auth/github/device/poll', { flowId }) as Promise<GithubDevicePoll>;

export const logoutGithub = () =>
  post('/api/auth/github/logout', {}) as Promise<{ ok: boolean }>;

export const getGithubInstallations = () =>
  request<{ installations: GithubInstallation[]; installUrl: string | null }>(
    '/api/auth/github/installations',
  );
