// Webhook receiver contract (P2-5): fail-closed secret, HMAC over the raw
// body, delivery dedupe, shadow mode never projecting, and the branch-scoped
// realtime reconcile handoff.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

vi.mock('./workflows-store.mjs', () => ({
  recordWebhookDelivery: vi.fn(async () => true),
  projectPullRequestWebhook: vi.fn(async () => 2),
  webhookCanChangeStageState: vi.fn(() => true),
  webhookBranchesForEvent: vi.fn(() => ['dev']),
  reconcileRealtime: vi.fn(async () => ({ outcome: 'completed', reconciled: 1 })),
}));

import { handleGithubWebhook, setShadowMode } from './automation.mjs';
import * as store from './workflows-store.mjs';

const SECRET = 'test-webhook-secret';
const PAYLOAD = JSON.stringify({
  action: 'opened',
  repository: { full_name: 'bayjf/loom' },
  installation: { id: 149185475 },
  pull_request: {
    number: 216,
    state: 'open',
    merged_at: null,
    head: { ref: 'feature/x' },
    base: { ref: 'dev' },
  },
});

function signature(body, secret = SECRET) {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

function headers(body = PAYLOAD, overrides = {}) {
  return {
    'x-hub-signature-256': signature(body),
    'x-github-delivery': 'delivery-1',
    'x-github-event': 'pull_request',
    ...overrides,
  };
}

function call(overrides = {}) {
  return handleGithubWebhook({
    method: 'POST',
    pathname: '/api/github-webhook',
    headers: headers(),
    rawBody: PAYLOAD,
    secret: SECRET,
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setShadowMode(false);
});

describe('handleGithubWebhook', () => {
  it('ignores non-webhook routes', async () => {
    expect(await handleGithubWebhook({
      method: 'GET', pathname: '/api/health', headers: {}, rawBody: PAYLOAD, secret: SECRET,
    })).toBeNull();
  });

  it('requires a raw body', async () => {
    expect(await call({ rawBody: '' })).toEqual({ status: 400, json: { error: 'raw body required' } });
  });

  it('fails closed when GITHUB_WEBHOOK_SECRET is missing', async () => {
    expect(await call({ secret: '' })).toEqual({
      status: 503,
      json: { error: 'GITHUB_WEBHOOK_SECRET is not configured' },
    });
    expect(store.recordWebhookDelivery).not.toHaveBeenCalled();
  });

  it('rejects a bad signature without touching the store', async () => {
    expect(await call({ headers: headers(PAYLOAD, { 'x-hub-signature-256': 'sha256=deadbeef' }) }))
      .toEqual({ status: 401, json: { error: 'invalid signature' } });
    expect(store.recordWebhookDelivery).not.toHaveBeenCalled();
  });

  it('rejects a missing delivery id or event name', async () => {
    expect(await call({
      headers: headers(PAYLOAD, { 'x-github-delivery': '', 'x-github-event': '' }),
    })).toEqual({ status: 400, json: { error: 'missing event headers' } });
  });

  it('rejects malformed JSON after a valid signature', async () => {
    const rawBody = '{not json';
    expect(await call({ rawBody, headers: headers(rawBody) }))
      .toEqual({ status: 400, json: { error: 'invalid JSON' } });
  });

  it('acknowledges a signed delivery without projecting in shadow mode', async () => {
    setShadowMode(true);
    expect(await call()).toEqual({ status: 200, json: { ok: true, shadow: true } });
    expect(store.recordWebhookDelivery).not.toHaveBeenCalled();
    expect(store.projectPullRequestWebhook).not.toHaveBeenCalled();
    expect(store.reconcileRealtime).not.toHaveBeenCalled();
  });

  it('projects a pull request and schedules a branch-scoped reconcile', async () => {
    const result = await call();
    expect(result?.status).toBe(202);
    expect(result?.json).toMatchObject({
      accepted: true,
      duplicate: false,
      projectedStages: 2,
      reconciliationScheduled: true,
      reconciliation: { outcome: 'completed', reconciled: 1 },
    });
    expect(store.recordWebhookDelivery).toHaveBeenCalledWith(expect.anything(), {
      deliveryId: 'delivery-1',
      eventName: 'pull_request',
      action: 'opened',
      repository: 'bayjf/loom',
      installationId: '149185475',
    });
    expect(store.projectPullRequestWebhook).toHaveBeenCalledWith(expect.anything(), {
      repository: 'bayjf/loom',
      installationId: '149185475',
      source: 'feature/x',
      target: 'dev',
      number: 216,
      state: 'open',
      mergedAt: null,
    });
    expect(store.reconcileRealtime).toHaveBeenCalledWith(expect.anything(), {
      repository: 'bayjf/loom',
      installationId: '149185475',
      eventName: 'pull_request',
      branches: ['dev'],
    }, 'webhook');
  });

  it('acknowledges a duplicate delivery without projecting or reconciling', async () => {
    store.recordWebhookDelivery.mockResolvedValueOnce(false);
    const result = await call();
    expect(result?.status).toBe(202);
    expect(result?.json).toMatchObject({
      accepted: false,
      duplicate: true,
      projectedStages: 0,
      reconciliationScheduled: false,
      reconciliation: null,
    });
    expect(store.projectPullRequestWebhook).not.toHaveBeenCalled();
    expect(store.reconcileRealtime).not.toHaveBeenCalled();
  });
});
