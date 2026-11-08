// AI generation through an OpenAI-compatible chat/completions endpoint.
// Ported from pr-helper-git: the credentials live on the server (config.json)
// and never travel to the browser — the client only ever sees a boolean.
import { git } from './git.mjs';
import { loadConfig, saveConfig } from './store.mjs';

// Characters of diff context handed to the model; a huge staged diff is
// truncated instead of being rejected outright.
export const AI_DIFF_LIMIT = 40000;
export const AI_COMMIT_LOG_LIMIT = 50;

export function chatCompletionsUrl(baseUrl) {
  return `${String(baseUrl || '').replace(/\/+$/, '')}/chat/completions`;
}

/** Merge a patch into the stored AI config. A blank apiKey keeps the current one. */
export function normalizeAiConfig(raw, current = {}) {
  const out = {
    baseUrl: typeof current.baseUrl === 'string' ? current.baseUrl : '',
    apiKey: typeof current.apiKey === 'string' ? current.apiKey : '',
    model: typeof current.model === 'string' ? current.model : '',
  };
  if (!raw || typeof raw !== 'object') return out;
  if (typeof raw.baseUrl === 'string') out.baseUrl = raw.baseUrl.trim().replace(/\/+$/, '');
  if (typeof raw.model === 'string') out.model = raw.model.trim();
  if (typeof raw.apiKey === 'string' && raw.apiKey.trim()) out.apiKey = raw.apiKey.trim();
  if (raw.clearKey === true) out.apiKey = '';
  return out;
}

/** Validation for values that came from the client, not from disk. */
export function validateAiConfig(ai) {
  if (ai.baseUrl && !/^https?:\/\//i.test(ai.baseUrl)) {
    return 'base URL must start with http:// or https://';
  }
  if (ai.baseUrl && ai.baseUrl.length > 500) return 'base URL is too long';
  if (ai.model.length > 200) return 'model name is too long';
  if (ai.apiKey.length > 4000) return 'API key is too long';
  return null;
}

export function isAiConfigured(ai) {
  return Boolean(ai && ai.baseUrl && ai.apiKey && ai.model);
}

export async function loadAiConfig() {
  const config = await loadConfig();
  return normalizeAiConfig(config.ai || {});
}

export async function saveAiConfig(ai) {
  const config = await loadConfig();
  config.ai = {
    baseUrl: ai.baseUrl,
    apiKey: ai.apiKey,
    model: ai.model,
  };
  await saveConfig(config);
  return config.ai;
}

/** The client-visible shape: never includes the key itself. */
export function publicAiConfig(ai) {
  return {
    configured: isAiConfigured(ai),
    baseUrl: ai.baseUrl,
    model: ai.model,
    hasKey: Boolean(ai.apiKey),
  };
}

export function buildCommitMessagePrompt(diffText) {
  const diff = diffText.length > AI_DIFF_LIMIT
    ? `${diffText.slice(0, AI_DIFF_LIMIT)}\n… (truncated)`
    : diffText;
  return [
    '根据以下 git staged diff 生成一条简洁的 commit message。',
    '要求：第一行为符合 Conventional Commits 的标题（type(scope): subject，不超过 72 字符），',
    '如有必要空一行后追加简短正文要点（最多 5 行）。',
    '只输出 commit message 本身，不要输出任何解释或 Markdown 代码块。',
    '',
    'Staged diff:',
    diff,
  ].join('\n');
}

export function buildPrDescriptionPrompt(source, target, commits) {
  const changes = commits.map((c) => `- ${c}`).join('\n');
  return [
    `为 Pull Request 生成标题和描述。分支：${source} → ${target}。提交：`,
    changes || '- (no commits)',
    '',
    '输出格式：',
    '第一行：简洁的 PR 标题（不超过 72 字符）；',
    '空一行；',
    '随后：Markdown 描述（要点列表，最多 10 条），不要包含标题本身。',
    '只输出这些内容，不要解释。',
  ].join('\n');
}

/**
 * Split the model output into { title, body }. The first non-empty line is the
 * title; everything after it (with the leading blank line removed) is the body.
 */
export function parsePrGeneration(text) {
  const raw = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return { title: '', body: '' };
  const lines = raw.split('\n');
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i += 1;
  const title = (lines[i] || '').trim().replace(/^#+\s*/, '').slice(0, 200);
  const rest = lines.slice(i + 1).join('\n').replace(/^\n+/, '').trim();
  return { title, body: rest };
}

/** One non-streaming chat completion; returns the assistant text. */
export async function complete(prompt, { signal, temperature = 0.3 } = {}) {
  const ai = await loadAiConfig();
  if (!isAiConfigured(ai)) {
    throw Object.assign(new Error('AI is not configured: set base URL, API key and model'), { status: 400 });
  }
  let response;
  try {
    response = await fetch(chatCompletionsUrl(ai.baseUrl), {
      method: 'POST',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ai.apiKey}`,
      },
      body: JSON.stringify({
        model: ai.model,
        stream: false,
        temperature,
        messages: [
          { role: 'system', content: 'You write git commit messages and pull-request descriptions. Reply only with the requested text.' },
          { role: 'user', content: prompt },
        ],
      }),
      signal: signal || AbortSignal.timeout(120_000),
    });
  } catch (err) {
    throw Object.assign(new Error(`AI request failed: ${err.message}`), { status: 502 });
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw Object.assign(
      new Error(`AI request failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`),
      { status: 502 },
    );
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw Object.assign(new Error('AI response was not valid JSON'), { status: 502 });
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw Object.assign(new Error('AI returned an empty completion'), { status: 502 });
  }
  return content.trim();
}

/** Staged diff used as commit-message context. */
export async function stagedDiff(repo) {
  const staged = await git(['diff', '--cached', '--no-color'], repo);
  return staged;
}

/** Commit subjects unique to `source` (target..source), oldest last. */
export async function branchCommitSubjects(repo, source, target) {
  const raw = await git(
    ['log', `--format=%s`, `--max-count=${AI_COMMIT_LOG_LIMIT}`, `${target}..${source}`],
    repo,
  );
  return raw.split('\n').map((l) => l.trim()).filter(Boolean);
}
