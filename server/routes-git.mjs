import { fail, ok } from './http.mjs';
import { validateRefName } from './security.mjs';
import { appendAudit } from './store.mjs';
import {
  branchCommitSubjects,
  buildCommitMessagePrompt,
  buildPrDescriptionPrompt,
  complete,
  isAiConfigured,
  loadAiConfig,
  parsePrGeneration,
  stagedDiff,
} from './ai.mjs';
import {
  findRegistered,
  gitFail,
  parseGrepLines,
  sensitiveChanges,
  sensitiveFail,
} from './routes-git-helpers.mjs';
import { handleGitMeta } from './routes-git-meta.mjs';
import { handleGitRead } from './routes-git-read.mjs';
import { handleGitWrite } from './routes-git-write.mjs';

export { parseGrepLines };


export async function handleGitRoute({ method, pathname, query, body, identity }) {

  const meta = await handleGitMeta({ method, pathname, query, body, identity });
  if (meta) return meta;

  // GitHub-specific endpoints are handled by routes-github.mjs; let them
  // fall through before the generic registered-repo guard below.
  if (pathname === '/api/github' || pathname === '/api/remote') return null;

  // All remaining routes operate on a registered repo.
  const repo = await findRegistered(method === 'GET' ? query.get('repo') : body.repo);
  if (!repo) return fail(403, 'unknown or unregistered repo');

  // ---------- AI generation ----------

  if (pathname === '/api/ai/commit-message') {
    if (method !== 'POST') return fail(405, 'method not allowed');
    const ai = await loadAiConfig();
    if (!isAiConfigured(ai)) return fail(400, 'AI is not configured');
    const sensitive = await sensitiveChanges(repo, { stagedOnly: true });
    if (sensitive.length) return sensitiveFail(sensitive, 'sent to the AI provider');
    let diff;
    try {
      diff = await stagedDiff(repo);
    } catch (err) {
      return gitFail(err, 'git diff --cached failed');
    }
    if (!diff.trim()) return fail(400, 'no staged changes to describe');
    try {
      const message = await complete(buildCommitMessagePrompt(diff));
      await appendAudit({ ok: true, action: 'ai-commit-message', repo, chars: diff.length });
      return ok({ message: message.replace(/^```[a-z]*\n?/i, '').replace(/```$/, '').trim() });
    } catch (err) {
      await appendAudit({ ok: false, action: 'ai-commit-message', repo });
      return fail(502, 'AI generation failed', err.message);
    }
  }

  if (pathname === '/api/ai/pr-description') {
    if (method !== 'POST') return fail(405, 'method not allowed');
    const ai = await loadAiConfig();
    if (!isAiConfigured(ai)) return fail(400, 'AI is not configured');
    const source = typeof body.source === 'string' ? body.source.trim() : '';
    const target = typeof body.target === 'string' ? body.target.trim() : '';
    if (!validateRefName(source) || !validateRefName(target)) {
      return fail(400, 'invalid source or target branch');
    }
    if (source === target) return fail(400, 'source and target must differ');
    let subjects;
    try {
      subjects = await branchCommitSubjects(repo, source, target);
    } catch (err) {
      return gitFail(err, 'git log failed');
    }
    if (!subjects.length) return fail(400, `no commits between ${target} and ${source}`);
    try {
      const text = await complete(buildPrDescriptionPrompt(source, target, subjects));
      const parsed = parsePrGeneration(text);
      await appendAudit({ ok: true, action: 'ai-pr-description', repo, source, target });
      return ok(parsed);
    } catch (err) {
      await appendAudit({ ok: false, action: 'ai-pr-description', repo, source, target });
      return fail(502, 'AI generation failed', err.message);
    }
  }

  const read = await handleGitRead({ method, pathname, query, body, identity }, repo);
  if (read) return read;

  const write = await handleGitWrite({ method, pathname, query, body, identity }, repo);
  if (write) return write;

  return null;
}
