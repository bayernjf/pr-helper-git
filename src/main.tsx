import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppDataProvider } from './app-state';
import ErrorBoundary from './components/ErrorBoundary';
import { ConfirmProvider, ToastProvider } from './components/ui';
import './styles.css';

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
