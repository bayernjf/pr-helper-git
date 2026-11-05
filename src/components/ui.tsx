// Minimal toast and confirm-dialog primitives.
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

interface ToastItem {
  id: number;
  kind: 'info' | 'error' | 'success';
  message: string;
}

interface ToastApi {
  notify: (message: string, kind?: ToastItem['kind']) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
const ConfirmContext = createContext<(question: string, detail?: string) => Promise<boolean>>(null as never);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const notify = useCallback((message: string, kind: ToastItem['kind'] = 'info') => {
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
            {t.message}
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

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {state && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <h3>{state.question}</h3>
            {state.detail && <p className="modal-detail">{state.detail}</p>}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => close(false)}>
                Cancel
              </button>
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
