import { post, request } from './core';

export interface A2aStatus {
  configured: boolean;
  source: 'env' | 'config' | null;
  hint: string | null;
  createdAt: string | null;
  allowAnonymous: boolean;
  cardUrl: string;
  skills: string[];
  tokenEnv: string;
  legacyTokenEnv: string;
}

export interface A2aToken {
  token: string;
  hint: string;
  createdAt: string;
  source: 'config';
}

export const getA2aStatus = () => request<A2aStatus>('/api/a2a/status');

export const generateA2aToken = () =>
  post('/api/a2a/token', {}) as Promise<A2aToken>;

export const revokeA2aToken = () =>
  request<{ ok: boolean; configured: boolean; source: 'env' | 'config' | null }>(
    '/api/a2a/token',
    { method: 'DELETE' },
  );
