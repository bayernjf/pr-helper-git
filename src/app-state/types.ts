import type { Accent, ThemeMode } from '../lib/appearance';

export type View = 'git' | 'pr' | 'dashboard' | 'flows' | 'ci';
export type Theme = ThemeMode;

// Preferences domain: view, theme, accent, PAT and server-PAT state.
// `refreshServerPat` is internal to the repo-load path (it re-reads server PAT
// availability after each repo load, fire-and-forget); consumers use
// `hasServerPat` / `setServerPat` / `clearServerPat` instead.
export interface Preferences {
  view: View;
  theme: Theme;
  accent: Accent;
  pat: string;
  hasServerPat: boolean;
  setView: (view: View) => void;
  setTheme: (mode: Theme) => void;
  setAccent: (accent: Accent) => void;
  toggleTheme: () => void;
  setPat: (value: string) => void;
  setServerPat: (value: string) => Promise<{ hasServerPat: boolean }>;
  clearServerPat: () => Promise<{ hasServerPat: boolean }>;
  refreshServerPat: () => void;
}
