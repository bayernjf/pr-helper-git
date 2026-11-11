import { post, request } from './core';

// ---------- AI generation ----------

export interface AiConfig {
  configured: boolean;
  baseUrl: string;
  model: string;
  hasKey: boolean;
}

export const getAiConfig = () => request<AiConfig>('/api/ai/config');

export const saveAiConfig = (cfg: {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  clearKey?: boolean;
}) => post('/api/ai/config', cfg) as Promise<AiConfig>;

export const testAi = () =>
  post('/api/ai/test', {}) as Promise<{ ok: boolean; reply: string }>;

export const generateCommitMessage = (repo: string) =>
  post('/api/ai/commit-message', { repo }) as Promise<{ message: string }>;

export const generatePrDescription = (repo: string, source: string, target: string) =>
  post('/api/ai/pr-description', { repo, source, target }) as Promise<{
    title: string;
    body: string;
  }>;
