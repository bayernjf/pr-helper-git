// Notifier tests (P4-1): dedupe window, drain-result extraction, kill-switch.
import { describe, expect, it, vi, beforeEach } from 'vitest';

const calls = { mac: [], feishu: [] };
vi.mock('node:child_process', () => ({
  execFile: vi.fn((cmd, args) => { calls.mac.push(args.join(' ')); }),
}));

const fetchMock = vi.fn(async () => ({ ok: true }));
vi.stubGlobal('fetch', fetchMock);

import { notifyFailure, notifyFromDrainResult } from './notifier.mjs';

beforeEach(() => {
  calls.mac.length = 0;
  calls.feishu.length = 0;
  fetchMock.mockClear();
  vi.useFakeTimers({ now: 1_000_000 });
});

describe('notifyFailure', () => {
  it('sends a macOS notification via osascript', () => {
    notifyFailure('标题', '正文', 'sig-1');
    expect(calls.mac).toHaveLength(1);
    expect(calls.mac[0]).toContain('标题');
    expect(calls.mac[0]).toContain('正文');
  });

  it('dedupes the same signature inside the window', () => {
    notifyFailure('t', 'b', 'sig-dup');
    notifyFailure('t', 'b', 'sig-dup');
    expect(calls.mac).toHaveLength(1);
  });

  it('allows the same signature after the window passes', () => {
    notifyFailure('t', 'b', 'sig-window');
    vi.advanceTimersByTime(11 * 60_000);
    notifyFailure('t', 'b', 'sig-window');
    expect(calls.mac).toHaveLength(2);
  });
});

describe('notifyFromDrainResult', () => {
  it('notifies for each drain failure row (bounded at 5)', () => {
    const failures = Array.from({ length: 7 }, (_, i) => ({ action: i, reason: `原因 ${i}` }));
    notifyFromDrainResult({ failures });
    // 5 notifications (bounded), each carrying the reason
    expect(calls.mac).toHaveLength(5);
    expect(calls.mac.join(' ')).toContain('原因 4');
  });

  it('ignores empty or malformed drain results', () => {
    notifyFromDrainResult(null);
    notifyFromDrainResult({});
    notifyFromDrainResult({ failures: [] });
    expect(calls.mac).toHaveLength(0);
  });
});

describe('feishu channel', () => {
  it('posts to the webhook when configured', () => {
    process.env.PR_HELPER_GIT_FEISHU_WEBHOOK = 'https://open.feishu.cn/hook/x';
    try {
      notifyFailure('t', 'b', 'sig-feishu');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe('https://open.feishu.cn/hook/x');
    } finally {
      delete process.env.PR_HELPER_GIT_FEISHU_WEBHOOK;
    }
  });

  it('skips feishu when not configured', () => {
    notifyFailure('t', 'b', 'sig-no-feishu');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
