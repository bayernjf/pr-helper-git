// Toast and confirm-dialog primitives.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useEscape } from '../hooks/use-escape';
import { IconAlert, IconCheck, IconInfo, IconX } from './icons';
import { t as translateText } from '../i18n';

export type ToastKind = 'info' | 'error' | 'success';

/** An action button on the toast (the old showToast undo affordance). */
export type ToastAction = { label: string; onAction: () => void };

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
}

export interface ToastApi {
  notify: (message: string, kind?: ToastKind, action?: ToastAction) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Both clients keep toasts on screen for the same window. */
const TOAST_DURATION_MS = 3600;
/** An undo affordance the reader cannot reach in time is worse than none. */
const TOAST_ACTION_DURATION_MS = 7000;

export interface ConfirmOptions {
  title: string;
  detail?: string;
  /** What the action changes, shown before the destructive confirmation. */
  impact?: string;
  /** How to recover if the action turns out to be wrong. */
  recovery?: string;
  confirmLabel?: string;
  /** Destructive actions get the red button; neutral ones stay primary. */
  danger?: boolean;
}

type ConfirmFn = (question: string | ConfirmOptions, detail?: string) => Promise<boolean>;
const ConfirmContext = createContext<ConfirmFn>(null as never);

let nextId = 1;

type ToastTimer = { timer: number | undefined; deadline: number; remaining: number };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // Hover/focus pauses the countdown so an undo stays reachable while the
  // reader is on it (the old toast's pause/resume), per toast in the stack.
  const timers = useRef(new Map<number, ToastTimer>());

  const dismiss = useCallback((id: number) => {
    const entry = timers.current.get(id);
    if (entry?.timer !== undefined) window.clearTimeout(entry.timer);
    timers.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pause = useCallback((id: number) => {
    const entry = timers.current.get(id);
    if (!entry || entry.timer === undefined) return;
    window.clearTimeout(entry.timer);
    entry.timer = undefined;
    entry.remaining = Math.max(0, entry.deadline - Date.now());
  }, []);

  const resume = useCallback((id: number) => {
    const entry = timers.current.get(id);
    if (!entry || entry.timer !== undefined) return;
    entry.deadline = Date.now() + entry.remaining;
    entry.timer = window.setTimeout(() => dismiss(id), entry.remaining);
  }, [dismiss]);

  const notify = useCallback((message: string, kind: ToastKind = 'info', action?: ToastAction) => {
    const id = nextId++;
    const duration = action ? TOAST_ACTION_DURATION_MS : TOAST_DURATION_MS;
    setToasts((prev) => [...prev, { id, kind, message, action }]);
    timers.current.set(id, {
      timer: window.setTimeout(() => dismiss(id), duration),
      deadline: Date.now() + duration,
      remaining: duration,
    });
  }, [dismiss]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const entry of pending.values()) {
        if (entry.timer !== undefined) window.clearTimeout(entry.timer);
      }
      pending.clear();
    };
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
          <div
            key={t.id}
            className={`toast toast-${t.kind}`}
            role={t.kind === 'error' ? 'alert' : 'status'}
            onMouseEnter={() => pause(t.id)}
            onMouseLeave={() => resume(t.id)}
            onFocus={() => pause(t.id)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) resume(t.id);
            }}
          >
            <span className="toast-icon">
              {t.kind === 'success' ? <IconCheck /> : t.kind === 'error' ? <IconAlert /> : <IconInfo />}
            </span>
            <span className="toast-msg">{translateText(t.message)}</span>
            {t.action ? (
              <button
                type="button"
                className="toast-action toast-undo"
                onClick={() => {
                  dismiss(t.id);
                  t.action?.onAction();
                }}
              >
                {translateText(t.action.label)}
              </button>
            ) : null}
            <button type="button" className="toast-close" aria-label={translateText("Dismiss notification")} onClick={() => dismiss(t.id)}>
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
            {state.impact && (
              <div className="modal-body confirm-fact" data-testid="confirm-impact">
                <h3>{translateText("Impact")}</h3>
                <p>{state.impact}</p>
              </div>
            )}
            {state.recovery && (
              <div className="modal-body confirm-fact" data-testid="confirm-recovery">
                <h3>{translateText("Recovery path")}</h3>
                <p>{state.recovery}</p>
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
