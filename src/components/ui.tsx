// Toast and confirm-dialog primitives.
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useEscape } from '../hooks/use-escape';
import { IconAlert, IconCheck, IconX } from './icons';

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
const ConfirmContext = createContext<(question: string, detail?: string) => Promise<boolean>>(null as never);

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
    }, 4200);
  }, []);

  const api = useMemo<ToastApi>(() => ({
    notify,
    error: (message: string) => notify(message, 'error'),
  }), [notify]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <span className="toast-icon">
              {t.kind === 'success' ? <IconCheck /> : <IconAlert />}
            </span>
            <span className="toast-msg">{t.message}</span>
            <button type="button" className="toast-close" aria-label="Dismiss notification" title="Dismiss" onClick={() => dismiss(t.id)}>
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

interface ConfirmState {
  question: string;
  detail?: string;
  resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);

  const ask = useCallback((question: string, detail?: string) =>
    new Promise<boolean>((resolve) => {
      setState({ question, detail, resolve });
    }), []);

  const close = (value: boolean) => {
    state?.resolve(value);
    setState(null);
  };

  // Escape cancels the confirmation, mirroring the Cancel button. This goes
  // through the shared stack so the modal underneath stays open.
  useEscape(() => close(false), !!state);

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {state && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal" style={{ width: 440 }}>
            <div className="modal-header">
              <h2>{state.question}</h2>
            </div>
            {state.detail && (
              <div className="modal-body">
                <p style={{ margin: 0, color: 'var(--muted)' }}>{state.detail}</p>
              </div>
            )}
            <div className="modal-footer">
              <button type="button" className="btn" onClick={() => close(false)}>Cancel</button>
              <button type="button" className="btn btn-danger" onClick={() => close(true)}>
                Confirm
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
