import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import MobileApp from './components/MobileApp';
import { AppDataProvider } from './app-state';
import ErrorBoundary from './components/ErrorBoundary';
import { ConfirmProvider, ToastProvider } from './components/ui';
import { getAccent, getThemeMode, applyAppearance } from './lib/appearance';
import { migrateStorage } from './lib/storage-keys';
import './styles.css';
import { installTooltips } from './design/tooltip';

// One-shot migration of pre-rename localStorage keys (git2-* / pr-helper-git2-*).
// Must run before applyAppearance() so prefs are read from the new key.
migrateStorage();

// Apply the saved theme and accent before the first paint so a light-theme
// user does not see a dark flash. The provider keeps them in sync afterwards.
applyAppearance(getThemeMode(), getAccent());

// /m (or /?mobile=1) serves a read-only, single-column layout for phones.
const params = new URLSearchParams(window.location.search);
const isMobileView = window.location.pathname.replace(/\/+$/, '') === '/m' || params.get('mobile') === '1';

const root = createRoot(document.getElementById('root')!);

installTooltips();

root.render(
  <StrictMode>
    <ToastProvider>
      <ConfirmProvider>
        <AppDataProvider>
          <ErrorBoundary>
            {isMobileView ? <MobileApp /> : <App />}
          </ErrorBoundary>
        </AppDataProvider>
      </ConfirmProvider>
    </ToastProvider>
  </StrictMode>,
);
