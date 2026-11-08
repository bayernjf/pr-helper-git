import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { IconAlert, IconRefresh } from './icons';
import { t } from '../i18n';

interface Props {
  children: ReactNode;
  label?: string;
}

interface State {
  error: Error | null;
}

// Catches render-time errors in the subtree so a single broken component shows
// a recoverable panel instead of a blank screen for the whole app.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep a local trace for debugging; never leak it to any network call.
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  private retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="error-boundary">
        <div className="error-boundary-card">
          <div className="error-boundary-icon">
            <IconAlert width={26} height={26} />
          </div>
          <h3>{this.props.label || 'Something went wrong'}</h3>
          <p className="error-boundary-msg">{error.message || 'An unexpected rendering error occurred.'}</p>
          <div className="error-boundary-actions">
            <button type="button" className="btn" onClick={this.retry}>
              <IconRefresh width={14} height={14} />
              {t("Try again")}</button>
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
              {t("Reload app")}</button>
          </div>
        </div>
      </div>
    );
  }
}
