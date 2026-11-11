// GIT_SEQUENCE_EDITOR shim for the interactive-rebase API.
//
// `git rebase -i` hands us its todo file; we replace the picks with the user's
// plan (order + action). Commits are matched by hash prefix, so the shim can
// reorder and relabel but never introduce a commit git did not put there.
//
// Environment:
//   PR_HELPER_GIT_REBASE_PLAN — JSON array of {hash, action}
// Exit 1 (with the reason on stderr) makes git abort the rebase, which is the
// safe failure mode for a stale or malformed plan.

import fs from 'node:fs';
import { applyTodoPlan } from './rebase-todo.mjs';

const todoFile = process.argv[2];
let plan = [];
try {
  plan = JSON.parse(process.env.PR_HELPER_GIT_REBASE_PLAN || '[]');
} catch {
  process.stderr.write('invalid PR_HELPER_GIT_REBASE_PLAN\n');
  process.exit(1);
}

if (!todoFile || !fs.existsSync(todoFile) || !Array.isArray(plan) || plan.length === 0) {
  process.stderr.write('rebase todo unavailable\n');
  process.exit(1);
}

const result = applyTodoPlan(fs.readFileSync(todoFile, 'utf8'), plan);
if ('error' in result) {
  process.stderr.write(`${result.error}\n`);
  process.exit(1);
}
fs.writeFileSync(todoFile, result.text);
