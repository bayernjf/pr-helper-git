import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppDataProvider } from './app-state';
import type { Theme } from './app-state';
import ErrorBoundary from './components/ErrorBoundary';
import { ConfirmProvider, ToastProvider } from './components/ui';
import { getPref } from './lib/prefs';
import './styles.css';

// Apply the saved theme before the first paint so a light-theme user does not
// see a dark flash. The provider keeps the attribute in sync afterwards.
document.documentElement.dataset.theme = getPref<Theme>('theme', 'dark');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <ConfirmProvider>
        <AppDataProvider>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </AppDataProvider>
      </ConfirmProvider>
    </ToastProvider>
  </StrictMode>,
);
