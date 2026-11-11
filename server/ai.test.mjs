import { describe, expect, it } from 'vitest';
import {
  AI_DIFF_LIMIT,
  buildCommitMessagePrompt,
  buildPrDescriptionPrompt,
  chatCompletionsUrl,
  isAiConfigured,
  normalizeAiConfig,
  parsePrGeneration,
  publicAiConfig,
  validateAiConfig,
} from './ai.mjs';

describe('chatCompletionsUrl', () => {
  it('joins the base URL without duplicating slashes', () => {
    expect(chatCompletionsUrl('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1/chat/completions');
    expect(chatCompletionsUrl('https://example.com/v1')).toBe('https://example.com/v1/chat/completions');
  });
});

describe('normalizeAiConfig', () => {
  it('trims values and strips trailing slashes from the base URL', () => {
    const out = normalizeAiConfig({ baseUrl: ' https://x.test/v1// ', model: ' gpt ', apiKey: ' key ' });
    expect(out).toEqual({ baseUrl: 'https://x.test/v1', model: 'gpt', apiKey: 'key' });
  });

  it('keeps the stored key when only the model changes', () => {
    const out = normalizeAiConfig({ model: 'm2' }, { baseUrl: 'https://x.test/v1', apiKey: 'secret', model: 'm' });
    expect(out.apiKey).toBe('secret');
  });

  it('clears the stored key when the base URL changes without a new key', () => {
    const out = normalizeAiConfig({ baseUrl: 'https://evil.test/v1' }, { baseUrl: 'https://x.test/v1', apiKey: 'secret' });
    expect(out.apiKey).toBe('');
  });

  it('clears the key only on an explicit clearKey', () => {
    const out = normalizeAiConfig({ clearKey: true }, { apiKey: 'secret' });
    expect(out.apiKey).toBe('');
  });
});

describe('validateAiConfig', () => {
  it('rejects a non-http base URL', () => {
    expect(validateAiConfig({ baseUrl: 'ftp://x', apiKey: '', model: 'm' })).toMatch(/http/i);
    expect(validateAiConfig({ baseUrl: 'https://x.test/v1', apiKey: '', model: 'm' })).toBeNull();
  });

  it('rejects credentials in the URL and remote plain HTTP', () => {
    expect(validateAiConfig({ baseUrl: 'https://user:pass@x.test/v1', apiKey: '', model: 'm' })).toMatch(/credentials/i);
    expect(validateAiConfig({ baseUrl: 'http://x.test/v1', apiKey: '', model: 'm' })).toMatch(/https/i);
    expect(validateAiConfig({ baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'm' })).toBeNull();
  });
});

describe('isAiConfigured / publicAiConfig', () => {
  it('requires base URL, key and model', () => {
    expect(isAiConfigured({ baseUrl: 'https://x', apiKey: 'k', model: 'm' })).toBe(true);
    expect(isAiConfigured({ baseUrl: 'https://x', apiKey: '', model: 'm' })).toBe(false);
  });

  it('never exposes the key itself', () => {
    const pub = publicAiConfig({ baseUrl: 'https://x', apiKey: 'secret', model: 'm' });
    expect(pub).toEqual({ configured: true, baseUrl: 'https://x', model: 'm', hasKey: true });
    expect(JSON.stringify(pub)).not.toContain('secret');
  });
});

describe('buildCommitMessagePrompt', () => {
  it('includes the diff and truncates an oversized one', () => {
    expect(buildCommitMessagePrompt('diff --git a b')).toContain('diff --git a b');
    const huge = 'x'.repeat(AI_DIFF_LIMIT + 100);
    const prompt = buildCommitMessagePrompt(huge);
    expect(prompt).toContain('(truncated)');
    expect(prompt.length).toBeLessThan(AI_DIFF_LIMIT + 400);
  });
});

describe('buildPrDescriptionPrompt', () => {
  it('lists every commit subject', () => {
    const prompt = buildPrDescriptionPrompt('feat', 'main', ['add a', 'fix b']);
    expect(prompt).toContain('feat → main');
    expect(prompt).toContain('- add a');
    expect(prompt).toContain('- fix b');
  });
});

describe('parsePrGeneration', () => {
  it('splits the first line into a title and keeps the rest as the body', () => {
    expect(parsePrGeneration('Add search\n\n## Summary\n- one\n- two')).toEqual({
      title: 'Add search',
      body: '## Summary\n- one\n- two',
    });
  });

  it('strips a leading markdown heading marker from the title', () => {
    expect(parsePrGeneration('## Fix login\n\nBody').title).toBe('Fix login');
  });

  it('returns empty values for empty output', () => {
    expect(parsePrGeneration('   \n ')).toEqual({ title: '', body: '' });
  });
});
