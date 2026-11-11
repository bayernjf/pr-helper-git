import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildHunkPatch,
  cleanCommitMessage,
  git,
  numstatTarget,
  parseBlame,
  parseLog,
  parsePorcelainV2,
  parseRefs,
  parseReflog,
  parseSubmoduleStatus,
  parseTagObject,
  splitFilePatch,
} from './git.mjs';
import { buildLineSelectionPatch, MAX_SELECTED_LINES, parseHunk } from './patch-lines.mjs';
import { fail, ok } from './http.mjs';
import { buildCommitSearch } from './search-commits.mjs';
import { validateRebasePlan } from './rebase-todo.mjs';
import {
  isSensitivePath,
  normalizeRepoPath,
  resolveInside,
  sanitizeUrlForAudit,
  validateCloneUrl,
  validateFolderName,
  validateRefName,
} from './security.mjs';
import {
  addRepo,
  appendAudit,
  configPaths,
  listRepos,
  loadConfig,
  pruneRepos,
  readAudit,
  removeRepo,
  rotateAudit,
  updateConfig,
} from './store.mjs';
import { createUser, listUsers, removeUser } from './identity.mjs';
import {
  branchCommitSubjects,
  buildCommitMessagePrompt,
  buildPrDescriptionPrompt,
  complete,
  isAiConfigured,
  loadAiConfig,
  normalizeAiConfig,
  parsePrGeneration,
  publicAiConfig,
  saveAiConfig,
  stagedDiff,
  validateAiConfig,
} from './ai.mjs';
import { ensureWatching, reconcileWatching, stopWatching } from './watcher.mjs';
import {
  CONFIG_SPEC_BY_KEY,
  CONFIG_SPECS,
  CONFIG_VALUE_MAX,
  DIFF_LINE_LIMIT,
  FILE_MAX_BYTES,
  LOG_LIMIT_DEFAULT,
  LOG_LIMIT_MAX,
  NETWORK_TIMEOUT_MS,
  REBASE_TIMEOUT_MS,
  SAVE_MAX_BYTES,
  changedPaths,
  detectRepoState,
  findRegistered,
  gitDirPath,
  gitFail,
  grepArgv,
  isAdmin,
  mapLimit,
  normalizeGrepGlob,
  normalizeRebaseBase,
  parseConfigList,
  parseGrepLines,
  readBisectState,
  rebaseCommits,
  rebaseGuardrails,
  repoBrief,
  resolveParentDir,
  sensitiveChanges,
  sensitiveFail,
  unmergedPaths,
  validateDateValue,
  validateFilterValue,
  validateRefSpec,
  validateStashIndex,
} from './routes-git-helpers.mjs';

import { handleGitWriteWorktree } from './routes-git-write-worktree.mjs';
import { handleGitWriteRefs } from './routes-git-write-refs.mjs';
import { handleGitWriteHistory } from './routes-git-write-history.mjs';
import { handleGitWriteFiles } from './routes-git-write-files.mjs';
import { handleGitWriteNetwork } from './routes-git-write-network.mjs';
import { handleGitWriteStash } from './routes-git-write-stash.mjs';

export async function handleGitWrite({ method, pathname, query, body, identity }, repo) {
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
