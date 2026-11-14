// Failure notifier (P4-1, D-005): pushes high-value automation failures to
// the operator via macOS local notifications (osascript) and, when
// configured, a Feishu incoming-webhook URL. Replaces pr-helper's Web Push
// (M-F23 ⏸) and its GitHub-Actions Feishu curl (M-F25 🔀).
//
// Event discipline: only operator-actionable failures notify — an automation
// action entering paused/failed (needs a takeover or regenerate), or the
// recovery policy being exhausted. Routine skips/requeues stay log-only.
//
// Configuration:
//   PR_HELPER_GIT_NOTIFY=0            disable notifications entirely
//   PR_HELPER_GIT_FEISHU_WEBHOOK=…    Feishu incoming webhook URL (optional)

import { execFile } from 'node:child_process';

const FEISHU_URL = () => process.env.PR_HELPER_GIT_FEISHU_WEBHOOK?.trim() || '';
const ENABLED = () => process.env.PR_HELPER_GIT_NOTIFY !== '0';

let lastSignature = '';
let lastSignatureAt = 0;
const DEDUPE_WINDOW_MS = 10 * 60_000;

/**
 * Notify about one actionable failure. `signature` dedupes repeated events
 * (a paused action stays paused until someone acts — one notification per
 * signature per 10 minutes, not one per drain pass).
 */
export function notifyFailure(title, body, signature = `${title}|${body}`) {
  if (!ENABLED()) return;
  const now = Date.now();
  if (signature === lastSignature && now - lastSignatureAt < DEDUPE_WINDOW_MS) return;
  lastSignature = signature;
  lastSignatureAt = now;
  sendMacNotification(title, body);
  sendFeishu(title, body);
}

function sendMacNotification(title, body) {
  if (process.platform !== 'darwin') return;
  // osascript with a list form avoids shell-quoting pitfalls in the text.
  const script = `display notification ${jsonString(body)} with title ${jsonString(title)}`;
  execFile('osascript', ['-e', script], (err) => {
    if (err) console.error(`[notify] macOS notification failed: ${err.message}`);
  });
}

function jsonString(text) {
  return JSON.stringify(String(text).slice(0, 200));
}

function sendFeishu(title, body) {
  const url = FEISHU_URL();
  if (!url) return;
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      msg_type: 'text',
      content: { text: `${title}\n${body}`.slice(0, 900) },
    }),
  })
    .then(async (res) => {
      if (!res.ok) console.error(`[notify] feishu webhook responded ${res.status}`);
    })
    .catch((err) => console.error(`[notify] feishu webhook failed: ${err.message}`));
}

/**
 * Inspect one drain result and notify about operator-actionable rows.
 * `result` is the engine's drain outcome (examined/executed/…/failures[]).
 */
export function notifyFromDrainResult(result) {
  if (!result || typeof result !== 'object') return;
  const failures = Array.isArray(result.failures) ? result.failures : [];
  for (const failure of failures.slice(0, 5)) {
    const what = typeof failure === 'string' ? failure : failure?.message || JSON.stringify(failure);
    notifyFailure(
      'pr-helper-git 自动化失败',
      String(what).slice(0, 180),
      `drain-failure|${what}`,
    );
  }
}
