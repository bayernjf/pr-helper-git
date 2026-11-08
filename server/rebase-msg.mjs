// GIT_EDITOR shim for the interactive-rebase API.
//
// git opens the editor for `reword` (a single message) and for `squash` (a file
// starting with "# This is a combination of N commits"). Reword messages come
// from the plan; a squash keeps git's own combined message. The shim never
// exits non-zero — failing here would leave the rebase stopped for no reason.
//
// Environment:
//   GIT2_REWORD_MSGS  — JSON array of {subject, message} still to be applied
//   GIT2_REWORD_STATE — file the consumed messages are written back to

import fs from 'node:fs';
import { resolveRewordMessage } from './rebase-todo.mjs';

const msgFile = process.argv[2];
if (!msgFile || !fs.existsSync(msgFile)) process.exit(0);

const stateFile = process.env.GIT2_REWORD_STATE;
let pending = [];
if (stateFile) {
  try {
    pending = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch { /* fall back to the initial payload below */ }
}
if (!Array.isArray(pending) || pending.length === 0) {
  try {
    pending = JSON.parse(process.env.GIT2_REWORD_MSGS || '[]');
  } catch {
    pending = [];
  }
}

const current = fs.readFileSync(msgFile, 'utf8');
const { text, consumed } = resolveRewordMessage(current, pending);
if (text !== null) {
  fs.writeFileSync(msgFile, text);
  if (stateFile) {
    fs.writeFileSync(stateFile, JSON.stringify(pending.filter((_, i) => i !== consumed)));
  }
}
process.exit(0);
