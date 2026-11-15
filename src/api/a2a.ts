import { request } from './core';

export interface A2aStatus {
  configured: boolean;
  allowAnonymous: boolean;
  cardUrl: string;
  skills: string[];
  tokenEnv: string;
  legacyTokenEnv: string;
}

export const getA2aStatus = () => request<A2aStatus>('/api/a2a/status');
