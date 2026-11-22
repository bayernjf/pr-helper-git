// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACCENTS,
  applyAppearance,
  getAccent,
  getThemeMode,
  resolveLight,
} from './appearance';

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.accent;
  vi.unstubAllGlobals();
});

describe('appearance preferences', () => {
  it('defaults to dark and the blue accent', () => {
    expect(getThemeMode()).toBe('dark');
    expect(getAccent()).toBe('blue');
  });

  it('accepts only known theme and accent values', () => {
    localStorage.setItem('pr-helper-git:prefs', JSON.stringify({ theme: 'light', accent: 'rose' }));
    expect(getThemeMode()).toBe('light');
    expect(getAccent()).toBe('rose');
    localStorage.setItem('pr-helper-git:prefs', JSON.stringify({ theme: 'bogus', accent: 'bogus' }));
    expect(getThemeMode()).toBe('dark');
    expect(getAccent()).toBe('blue');
    expect(ACCENTS).toEqual(['blue', 'rose', 'forest', 'amber', 'teal', 'crimson', 'indigo']);
  });

  it('uses matchMedia only in auto mode', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })) as unknown as typeof window.matchMedia);
    expect(resolveLight('light')).toBe(true);
    expect(resolveLight('dark')).toBe(false);
    expect(resolveLight('auto')).toBe(true);
  });

  it('writes data-theme and omits the default accent attribute', () => {
    applyAppearance('light', 'blue');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.accent).toBeUndefined();

    applyAppearance('dark', 'forest');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.accent).toBe('forest');
  });
});
