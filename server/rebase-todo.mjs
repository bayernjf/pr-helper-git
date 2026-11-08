// Interactive-rebase plan handling.
//
// The server never trusts the browser's commit list: it re-reads the range, and
// `validateRebasePlan` only accepts a permutation of exactly those commits. The
// two shims below (`rebase-sequence.mjs`, `rebase-msg.mjs`) then rewrite git's
// todo/message files so `git rebase -i` runs without an interactive editor.

export const REBASE_ACTIONS = ['pick', 'reword', 'edit', 'squash', 'fixup', 'drop'];
export const MAX_REBASE_COMMITS = 200;
export const MAX_REBASE_MESSAGE = 5000;

/** Abbreviated hash git shows in the todo, kept stable for rewriting. */
function abbrev(hash) {
  return String(hash).slice(0, 7);
}

function cleanSubject(subject) {
  // One todo line holds one commit; a newline in the subject would split it.
  return String(subject || '').replace(/[\r\n]+/g, ' ').trim();
}

/**
 * @param {{hash: string, subject: string}[]} commits oldest first
 * @param {{hash: string, action: string, message?: string}[]} commands in the
 *   order the user arranged them
 * @returns {{error: string} | {plan: {hash: string, action: string, message: string, subject: string}[]}}
 */
export function validateRebasePlan(commits, commands) {
  if (!Array.isArray(commands) || commands.length === 0) return { error: 'missing rebase commands' };
  if (commits.length === 0) return { error: 'nothing to rebase' };
  if (commits.length > MAX_REBASE_COMMITS) return { error: 'too many commits to rebase' };

  const byHash = new Map(commits.map((c) => [c.hash, c]));
  const seen = new Set();
  const plan = [];

  for (const command of commands) {
    const hash = typeof command?.hash === 'string' ? command.hash.trim() : '';
    if (!byHash.has(hash)) return { error: `unknown commit ${hash || '(empty)'}` };
    if (seen.has(hash)) return { error: `commit listed twice: ${abbrev(hash)}` };
    seen.add(hash);
    const action = String(command?.action || '');
    if (!REBASE_ACTIONS.includes(action)) return { error: `invalid action: ${action || '(empty)'}` };
    let message = '';
    if (action === 'reword') {
      message = typeof command?.message === 'string' ? command.message.trim() : '';
      if (!message) return { error: 'reword needs a commit message' };
      if (message.length > MAX_REBASE_MESSAGE) return { error: 'reword message is too long' };
    }
    plan.push({ hash, action, message, subject: byHash.get(hash).subject });
  }

  // A plan must cover the range: silently omitting a commit would be a drop the
  // user never asked for.
  if (seen.size !== commits.length) {
    const missing = commits.filter((c) => !seen.has(c.hash)).map((c) => abbrev(c.hash));
    return { error: `plan omits ${missing.join(', ')}` };
  }
  if (plan[0].action === 'squash' || plan[0].action === 'fixup') {
    return { error: 'the first commit cannot be squashed' };
  }
  for (let i = 1; i < plan.length; i += 1) {
    const prev = plan[i - 1];
    if ((plan[i].action === 'squash' || plan[i].action === 'fixup') && prev.action === 'drop') {
      return { error: 'cannot squash into a dropped commit' };
    }
  }
  return { plan };
}

/** The todo git would show, one line per commit, in plan order. */
export function renderTodo(plan) {
  return plan.map((item) => `${item.action} ${abbrev(item.hash)} # ${cleanSubject(item.subject)}`).join('\n');
}

/**
 * Rewrite the todo file git handed us. Commits are matched by hash prefix (the
 * reverse direction is refused: a short client hash could prefix-collide), so
 * this can reorder and relabel but never invent a commit. The trailing comment
 * block is preserved so the file stays self-documenting.
 *
 * @param {string} todoText
 * @param {{hash: string, action: string, subject?: string}[]} plan
 * @returns {{error: string} | {text: string}}
 */
export function applyTodoPlan(todoText, plan) {
  const lines = String(todoText ?? '').split('\n');
  const entries = [];
  const comments = [];
  for (const line of lines) {
    if (/^\s*#/.test(line) || line.trim() === '') {
      comments.push(line);
      continue;
    }
    const match = line.match(/^(\w+)\s+([0-9a-f]{4,40})\s*(.*)$/);
    if (!match) return { error: `unrecognised todo line: ${line}` };
    entries.push({ action: match[1], abbrev: match[2].toLowerCase(), rest: match[3] });
  }

  const used = new Set();
  const output = [];
  for (const item of plan) {
    const target = String(item.hash).toLowerCase();
    const index = entries.findIndex(
      (entry, i) => !used.has(i) && target.startsWith(entry.abbrev),
    );
    if (index < 0) return { error: `commit ${abbrev(item.hash)} is not in the rebase todo` };
    used.add(index);
    const entry = entries[index];
    // Keep git's own "oneline" comment so the rewritten file still reads well.
    output.push(`${item.action} ${entry.abbrev}${entry.rest ? ` ${entry.rest}` : ''}`);
  }
  if (used.size !== entries.length) {
    const extra = entries.filter((_, i) => !used.has(i)).map((entry) => entry.abbrev);
    return { error: `todo has commits outside the plan: ${extra.join(', ')}` };
  }
  const commentBlock = comments.filter((line) => line.trim() !== '');
  return { text: [...output, '', ...commentBlock].join('\n') };
}

/**
 * Decide what a `GIT_EDITOR` invocation during the rebase should write.
 *
 * git opens the editor for `reword` (one message) and for `squash` (a
 * concatenation starting with "# This is a combination of N commits"). Only the
 * former carries a message from us; the squash default is left untouched so
 * git's own combined message stands.
 *
 * @param {string} current message file body git pre-filled
 * @param {{subject: string, message: string}[]} pending reword messages left
 * @returns {{text: string | null, consumed: number}}
 */
export function resolveRewordMessage(current, pending) {
  if (/# This is a combination of \d+ commits?/.test(current)) return { text: null, consumed: -1 };
  const subject = String(current).split('\n').find((line) => !/^\s*#/.test(line) && line.trim() !== '') || '';
  const index = pending.findIndex((item) => item.subject.trim() === subject.trim());
  if (index < 0) return { text: null, consumed: -1 };
  const message = pending[index].message.endsWith('\n') ? pending[index].message : `${pending[index].message}\n`;
  return { text: message, consumed: index };
}
