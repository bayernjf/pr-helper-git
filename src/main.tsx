import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import MobileApp from './components/MobileApp';
import { AppDataProvider } from './app-state';
import type { Theme } from './app-state';
import ErrorBoundary from './components/ErrorBoundary';
import { ConfirmProvider, ToastProvider } from './components/ui';
import { getPref } from './lib/prefs';
import './styles.css';
import { installTooltips } from './design/tooltip';

// Apply the saved theme before the first paint so a light-theme user does not
// see a dark flash. The provider keeps the attribute in sync afterwards.
document.documentElement.dataset.theme = getPref<Theme>('theme', 'dark');

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
