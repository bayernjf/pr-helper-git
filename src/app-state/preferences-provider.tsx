import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { deleteServerPat, getPatStatus, storeServerPat } from '../api';
import { applyAppearance, getAccent, getThemeMode, type Accent } from '../lib/appearance';
import { getPref, setPref } from '../lib/prefs';
import { STORAGE_KEYS } from '../lib/storage-keys';
import type { Preferences, Theme, View } from './types';

const PAT_KEY = STORAGE_KEYS.pat;

// Exported so render tests can inject a mock context without booting the
// full provider (which performs local-storage side effects).
export const PreferencesContext = createContext<Preferences | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [view, setViewState] = useState<View>(() => getPref<View>('view', 'git'));
  const [sidebarCollapsed, setSidebarCollapsedState] = useState<boolean>(() => getPref<boolean>('sidebarCollapsed', false));
  const [detailCollapsed, setDetailCollapsedState] = useState<boolean>(() => getPref<boolean>('detailCollapsed', false));
  const [workPanelCollapsed, setWorkPanelCollapsedState] = useState<boolean>(() => getPref<boolean>('workPanelCollapsed', false));
  const [theme, setTheme] = useState<Theme>(() => getThemeMode());
  const [accent, setAccentState] = useState<Accent>(() => getAccent());
  const [pat, setPatState] = useState<string>(() => localStorage.getItem(PAT_KEY) || '');
  const [hasServerPat, setHasServerPat] = useState(false);

  const setPat = useCallback((value: string) => {
    setPatState(value);
    localStorage.setItem(PAT_KEY, value);
  }, []);
  const setServerPat = useCallback(async (value: string) => {
    const result = await storeServerPat(value);
    setHasServerPat(result.hasServerPat);
    // Server-stored mode: the browser copy is no longer needed.
    localStorage.removeItem(PAT_KEY);
    setPatState('');
    return result;
  }, []);
  const clearServerPat = useCallback(async () => {
    const result = await deleteServerPat();
    setHasServerPat(false);
    return result;
  }, []);
  // Server-side PAT availability gates the PR views alongside the browser-local
  // PAT (server-stored mode keeps no PAT in the browser). The repo-load path
  // re-reads this after each load; fire-and-forget, matching the original
  // getPatStatus side effect in loadRepoData.
  const refreshServerPat = useCallback(() => {
    getPatStatus().then((s) => setHasServerPat(s.hasServerPat)).catch(() => undefined);
  }, []);

  // Persist the active view so a reload restores it.
  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    setSidebarCollapsedState(collapsed);
    setPref('sidebarCollapsed', collapsed);
  }, []);
  const setDetailCollapsed = useCallback((collapsed: boolean) => {
    setDetailCollapsedState(collapsed);
    setPref('detailCollapsed', collapsed);
  }, []);
  const setWorkPanelCollapsed = useCallback((collapsed: boolean) => {
    setWorkPanelCollapsedState(collapsed);
    setPref('workPanelCollapsed', collapsed);
  }, []);

  const setView = useCallback((next: View) => {
    setViewState(next);
    setPref('view', next);
  }, []);

  // Reflect mode + accent on <html>, persist them, and follow the OS while the
  // mode is "auto". main.tsx applies the saved values before first paint.
  useEffect(() => {
    applyAppearance(theme, accent);
    setPref('theme', theme);
    setPref('accent', accent);
    if (theme !== 'auto') return;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => applyAppearance('auto', accent);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme, accent]);

  const setAccent = useCallback((next: Accent) => setAccentState(next), []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : prev === 'light' ? 'auto' : 'dark'));
  }, []);

  const value = useMemo<Preferences>(() => ({
    view,
    sidebarCollapsed,
    setSidebarCollapsed,
    detailCollapsed,
    setDetailCollapsed,
    workPanelCollapsed,
    setWorkPanelCollapsed,
    theme,
    accent,
    pat,
    hasServerPat,
    setView,
    setTheme,
    setAccent,
    toggleTheme,
    setPat,
    setServerPat,
    clearServerPat,
    refreshServerPat,
  }), [
    view, sidebarCollapsed, setSidebarCollapsed, detailCollapsed, setDetailCollapsed,
    workPanelCollapsed, setWorkPanelCollapsed, theme, accent, pat, hasServerPat,
    setView, setTheme, setAccent, toggleTheme,
    setPat, setServerPat, clearServerPat, refreshServerPat,
  ]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): Preferences {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences must be used inside PreferencesProvider');
  return ctx;
}
