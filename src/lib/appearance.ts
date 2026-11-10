// Appearance model shared by the early paint, the app provider, the toolbar
// button and the settings modal. Mode controls surfaces; accent only swaps the
// action/highlight family.
import { getPref } from './prefs';

export type ThemeMode = 'dark' | 'light' | 'auto';
export type Accent = 'violet' | 'ocean' | 'forest' | 'amber';

export const ACCENTS: Accent[] = ['violet', 'ocean', 'forest', 'amber'];

export function getThemeMode(): ThemeMode {
  const value = getPref<ThemeMode>('theme', 'dark');
  return value === 'light' || value === 'auto' ? value : 'dark';
}

export function getAccent(): Accent {
  const value = getPref<Accent>('accent', 'violet');
  return ACCENTS.includes(value) ? value : 'violet';
}

export function resolveLight(mode: ThemeMode): boolean {
  return mode === 'light'
    || (mode === 'auto' && window.matchMedia('(prefers-color-scheme: light)').matches);
}

/** Apply mode + accent to the document root; safe before first paint. */
export function applyAppearance(mode: ThemeMode, accent: Accent): void {
  document.documentElement.dataset.theme = resolveLight(mode) ? 'light' : 'dark';
  if (accent === 'violet') delete document.documentElement.dataset.accent;
  else document.documentElement.dataset.accent = accent;
}
