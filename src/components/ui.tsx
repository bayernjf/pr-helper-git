// Toast and confirm-dialog primitives.
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useEscape } from '../hooks/use-escape';
import { IconAlert, IconCheck, IconInfo, IconX } from './icons';
import { t as translateText } from '../i18n';

export type ToastKind = 'info' | 'error' | 'success';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  notify: (message: string, kind?: ToastKind) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Both clients keep toasts on screen for the same window. */
const TOAST_DURATION_MS = 3600;

export interface ConfirmOptions {
  title: string;
  detail?: string;
  confirmLabel?: string;
  /** Destructive actions get the red button; neutral ones stay primary. */
  danger?: boolean;
}

type ConfirmFn = (question: string | ConfirmOptions, detail?: string) => Promise<boolean>;
const ConfirmContext = createContext<ConfirmFn>(null as never);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_DURATION_MS);
  }, []);

  const api = useMemo<ToastApi>(() => ({
    notify,
    error: (message: string) => notify(message, 'error'),
  }), [notify]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" role="region" aria-live="polite" aria-label={translateText("Notifications")}>
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            <span className="toast-icon">
              {t.kind === 'success' ? <IconCheck /> : t.kind === 'error' ? <IconAlert /> : <IconInfo />}
            </span>
            <span className="toast-msg">{translateText(t.message)}</span>
            <button type="button" className="toast-close" aria-label={translateText("Dismiss notification")} title={translateText("Dismiss")} onClick={() => dismiss(t.id)}>
              <IconX width={13} height={13} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

interface ConfirmState extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);

  const ask = useCallback<ConfirmFn>((question, detail) =>
    new Promise<boolean>((resolve) => {
      const options: ConfirmOptions = typeof question === 'string'
        ? { title: question, detail, danger: true }
        : { danger: true, ...question };
      setState({ ...options, resolve });
    }), []);

  const close = (value: boolean) => {
    state?.resolve(value);
    setState(null);
  };

  // Escape cancels the confirmation, mirroring the Cancel button. This goes
  // through the shared stack so the modal underneath stays open.
  useEscape(() => close(false), !!state);

  const titleId = 'confirm-dialog-title';
  const detailId = 'confirm-dialog-detail';

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {state && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={state.detail ? detailId : undefined}
          onClick={(event) => {
            if (event.target === event.currentTarget) close(false);
          }}
        >
          <div className="modal" style={{ width: 440 }}>
            <div className="modal-header">
              <h2 id={titleId}>{state.title}</h2>
            </div>
            {state.detail && (
              <div className="modal-body" id={detailId}>
                <p style={{ margin: 0, color: 'var(--muted)' }}>{state.detail}</p>
              </div>
            )}
            <div className="modal-footer">
              <button type="button" className="btn" onClick={() => close(false)}>{translateText("Cancel")}</button>
              <button
                type="button"
                className={`btn ${state.danger === false ? 'btn-primary' : 'btn-danger'}`}
                onClick={() => close(true)}
              >
                {translateText(state.confirmLabel || "Confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmContext);
}
