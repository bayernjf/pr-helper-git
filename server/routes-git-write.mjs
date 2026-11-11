// Write-route dispatcher. Each sub-handler matches its own endpoints and
// returns { status, json } or null; the first non-null result wins.
import { handleGitWriteWorktree } from './routes-git-write-worktree.mjs';
import { handleGitWriteRefs } from './routes-git-write-refs.mjs';
import { handleGitWriteHistory } from './routes-git-write-history.mjs';
import { handleGitWriteFiles } from './routes-git-write-files.mjs';
import { handleGitWriteNetwork } from './routes-git-write-network.mjs';
import { handleGitWriteStash } from './routes-git-write-stash.mjs';

export async function handleGitWrite({ method, pathname, query, body, identity }, repo) {
  // Every write endpoint mutates the repository, so reject non-POST here in one
  // place instead of repeating the guard across ~50 path branches (a GET could
  // otherwise reach e.g. /api/merge/abort?repo=… because the sub-handlers only
  // match on pathname).
  if (method !== 'POST') return null;

  const worktree = await handleGitWriteWorktree({ method, pathname, query, body, identity }, repo);
  if (worktree) return worktree;

  const refs = await handleGitWriteRefs({ method, pathname, query, body, identity }, repo);
  if (refs) return refs;

  const history = await handleGitWriteHistory({ method, pathname, query, body, identity }, repo);
  if (history) return history;

  const files = await handleGitWriteFiles({ method, pathname, query, body, identity }, repo);
  if (files) return files;

  const network = await handleGitWriteNetwork({ method, pathname, query, body, identity }, repo);
  if (network) return network;

  const stash = await handleGitWriteStash({ method, pathname, query, body, identity }, repo);
  if (stash) return stash;

  return null;
}
