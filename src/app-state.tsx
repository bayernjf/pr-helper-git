// Barrel for the split application state. The aggregate AppData context has
// been replaced by four domain contexts (preferences, repo data, write actions,
// busy) plus the existing ToastProvider. AppDataProvider just composes them;
// consumers subscribe through the domain hooks below.
import type { ReactNode } from 'react';
import { PreferencesProvider } from './app-state/preferences-provider';
import { RepoDataProvider } from './app-state/repo-provider';
import { ActionsProvider } from './app-state/actions-provider';

export { LOG_MAX } from './app-state/repo-provider';
export { usePreferences } from './app-state/preferences-provider';
export { useRepoData } from './app-state/repo-provider';
export { useRunAction, useBusy } from './app-state/actions-provider';
export { useAppToast } from './app-state/toast';

export function AppDataProvider({ children }: { children: ReactNode }) {
  return (
    <PreferencesProvider>
      <RepoDataProvider>
        <ActionsProvider>
          {children}
        </ActionsProvider>
      </RepoDataProvider>
    </PreferencesProvider>
  );
}
