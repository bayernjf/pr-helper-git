import { describe, expect, it } from 'vitest';
import { applyTodoPlan, renderTodo, resolveRewordMessage, validateRebasePlan } from './rebase-todo.mjs';

const commits = [
  { hash: 'a'.repeat(40), subject: 'first' },
  { hash: 'b'.repeat(40), subject: 'second' },
  { hash: 'c'.repeat(40), subject: 'third' },
];

describe('validateRebasePlan', () => {
  it('accepts a full permutation of the range', () => {
    const out = validateRebasePlan(commits, [
      { hash: commits[2].hash, action: 'pick' },
      { hash: commits[0].hash, action: 'pick' },
      { hash: commits[1].hash, action: 'pick' },
    ]);
    expect(out.error).toBeUndefined();
    expect(out.plan.map((item) => item.subject)).toEqual(['third', 'first', 'second']);
  });

  it('rejects commits outside the range, duplicates and missing commits', () => {
    expect(validateRebasePlan(commits, [{ hash: 'd'.repeat(40), action: 'pick' }]).error)
      .toMatch(/unknown commit/);
    expect(validateRebasePlan(commits, [
      { hash: commits[0].hash, action: 'pick' },
      { hash: commits[0].hash, action: 'drop' },
      { hash: commits[1].hash, action: 'pick' },
    ]).error).toMatch(/listed twice/);
    expect(validateRebasePlan(commits, [
      { hash: commits[0].hash, action: 'pick' },
      { hash: commits[1].hash, action: 'pick' },
    ]).error).toMatch(/omits ccccccc/);
  });

  it('requires a message for reword and rejects bad actions', () => {
    expect(validateRebasePlan(commits, [
      { hash: commits[0].hash, action: 'reword' },
      { hash: commits[1].hash, action: 'pick' },
      { hash: commits[2].hash, action: 'pick' },
    ]).error).toMatch(/needs a commit message/);
    expect(validateRebasePlan(commits, [
      { hash: commits[0].hash, action: 'explode' },
      { hash: commits[1].hash, action: 'pick' },
      { hash: commits[2].hash, action: 'pick' },
    ]).error).toMatch(/invalid action/);
  });

  it('refuses to squash the first commit or into a dropped one', () => {
    expect(validateRebasePlan(commits, [
      { hash: commits[0].hash, action: 'squash' },
      { hash: commits[1].hash, action: 'pick' },
      { hash: commits[2].hash, action: 'pick' },
    ]).error).toMatch(/first commit cannot be squashed/);
    expect(validateRebasePlan(commits, [
      { hash: commits[0].hash, action: 'pick' },
      { hash: commits[1].hash, action: 'drop' },
      { hash: commits[2].hash, action: 'fixup' },
    ]).error).toMatch(/dropped commit/);
  });
});

describe('applyTodoPlan', () => {
  const todo = [
    'pick aaaaaaa # first',
    'pick bbbbbbb # second',
    'pick ccccccc # third',
    '',
    '# Rebase 1234567 onto 89abcde (3 commands)',
    '#',
    '# Commands:',
    '# p, pick <commit> = use commit',
  ].join('\n');

  it('reorders and relabels while keeping the comment block', () => {
    const out = applyTodoPlan(todo, [
      { hash: commits[2].hash, action: 'pick' },
      { hash: commits[0].hash, action: 'reword' },
      { hash: commits[1].hash, action: 'drop' },
    ]);
    expect(out.error).toBeUndefined();
    expect(out.text.split('\n').slice(0, 3)).toEqual([
      'pick ccccccc # third',
      'reword aaaaaaa # first',
      'drop bbbbbbb # second',
    ]);
    expect(out.text).toContain('# Commands:');
  });

  it('fails closed when the todo has a commit the plan never mentioned', () => {
    expect(applyTodoPlan(todo, [
      { hash: commits[0].hash, action: 'pick' },
      { hash: commits[1].hash, action: 'pick' },
    ]).error).toMatch(/outside the plan: ccccccc/);
  });

  it('fails when a planned commit is absent from the todo', () => {
    const partial = 'pick aaaaaaa # first\n\n# comment\n';
    expect(applyTodoPlan(partial, [
      { hash: commits[0].hash, action: 'pick' },
      { hash: commits[1].hash, action: 'pick' },
    ]).error).toMatch(/is not in the rebase todo/);
  });
});

describe('resolveRewordMessage', () => {
  it('replaces the message of a matching reword and consumes one entry', () => {
    const pending = [{ subject: 'second', message: 'second, reworded' }];
    const out = resolveRewordMessage('second\n\n# Please enter the commit message\n', pending);
    expect(out.consumed).toBe(0);
    expect(out.text).toBe('second, reworded\n');
  });

  it('leaves a squash message alone even if a subject matches', () => {
    const pending = [{ subject: 'first', message: 'should not be used' }];
    const current = '# This is a combination of 2 commits.\n# This is the 1st commit message:\n\nfirst\n';
    const out = resolveRewordMessage(current, pending);
    expect(out.text).toBeNull();
    expect(out.consumed).toBe(-1);
  });

  it('leaves the file untouched when nothing matches', () => {
    const out = resolveRewordMessage('something else\n', [{ subject: 'first', message: 'x' }]);
    expect(out.text).toBeNull();
  });

  it('matches duplicate subjects in order', () => {
    const pending = [
      { subject: 'same', message: 'one' },
      { subject: 'same', message: 'two' },
    ];
    expect(resolveRewordMessage('same\n\n# body\n', pending)).toMatchObject({ text: 'one\n', consumed: 0 });
    expect(resolveRewordMessage('same\n\n# body\n', pending.slice(1))).toMatchObject({ text: 'two\n', consumed: 0 });
  });
});

describe('renderTodo', () => {
  it('writes one line per commit with an abbreviated hash', () => {
    expect(renderTodo([
      { hash: commits[1].hash, action: 'pick', subject: 'second' },
      { hash: commits[2].hash, action: 'drop', subject: 'third\nwith newline' },
    ])).toBe('pick bbbbbbb # second\ndrop ccccccc # third with newline');
  });
});
