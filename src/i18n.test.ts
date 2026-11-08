import { describe, expect, it, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ZH, auditAction, getLocale, setLocale, t, tp } from './i18n';

beforeEach(() => {
  setLocale('en');
});

describe('i18n', () => {
  it('returns the English source in en mode and translates in zh mode', () => {
    expect(getLocale()).toBe('en');
    expect(t('Settings')).toBe('Settings');
    setLocale('zh');
    expect(t('Settings')).toBe('设置');
    expect(t('Cancel')).toBe('取消');
  });

  it('falls back to English for unknown keys', () => {
    setLocale('zh');
    expect(t('some string nobody translated')).toBe('some string nobody translated');
  });

  it('translates counted strings with rules', () => {
    setLocale('zh');
    expect(t('12 commits')).toBe('12 次提交');
    expect(t('3 repositories')).toBe('3 个仓库');
    expect(t('7 of 9 commits')).toBe('保留 7 / 9 个提交');
    expect(t('4 selected')).toBe('已选 4 项');
    expect(t('2 matches across 3 repos')).toBe('2 个匹配，涉及 3 个仓库');
  });

  it('fills {placeholders}', () => {
    setLocale('zh');
    expect(tp('Commit {sha}', { sha: 'abc1234' })).toBe('Commit abc1234');
    expect(tp('Settings', {})).toBe('设置');
  });

  it('every t("…") key used in the components exists in the dictionary', () => {
    const roots = ['src', 'src/components'];
    const files = roots.flatMap((dir) =>
      fs.readdirSync(path.join(process.cwd(), dir))
        .filter((name) => (name.endsWith('.tsx') || name.endsWith('.ts'))
          && !name.includes('.test.'))
        .map((name) => path.join(dir, name)));
    const used = new Set<string>();
    for (const file of files) {
      const text = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
      for (const match of text.matchAll(/\bt\("((?:[^"\\]|\\.)*)"\)/g)) used.add(match[1]);
      for (const match of text.matchAll(/\bt\('((?:[^'\\]|\\.)*)'\)/g)) used.add(match[1]);
    }
    expect(used.size).toBeGreaterThan(100);
    const missing = [...used]
      .filter((key) => /[A-Za-z]/.test(key))
      .filter((key) => !(key in ZH));
    expect(missing).toEqual([]);
  });

  it('labels audit actions in Chinese and passes them through in English', () => {
    setLocale('zh');
    expect(auditAction('repo-add')).toBe('添加仓库');
    expect(auditAction('stash-create')).toBe('创建储藏');
    expect(auditAction('unknown-action')).toBe('unknown-action');
    setLocale('en');
    expect(auditAction('repo-add')).toBe('repo-add');
  });
});
