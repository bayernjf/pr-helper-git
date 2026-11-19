// @vitest-environment jsdom
// Toast undo affordance (the old showToast undo): an action button with a
// longer window, a countdown that pauses while the reader is on the toast,
// and dismissal that never fires the action by accident.
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast, type ToastApi } from './ui';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement;
let api: ToastApi;

function Probe() {
  api = useToast();
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.replaceChildren();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(createElement(ToastProvider, null, createElement(Probe)));
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.useRealTimers();
});

const toasts = () => [...document.querySelectorAll('.toast')];

describe('ToastProvider undo action', () => {
  it('renders the action button; clicking it runs the callback and dismisses the toast', () => {
    const onAction = vi.fn();
    act(() => api.notify('gate removed', 'info', { label: 'undo', onAction }));
    const undo = document.querySelector('.toast-undo') as HTMLButtonElement;
    expect(undo).not.toBeNull();
    act(() => undo.click());
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(toasts()).toHaveLength(0);
  });

  it('keeps action toasts for 7s and plain toasts for 3.6s', () => {
    act(() => api.notify('plain'));
    act(() => api.notify('with undo', 'info', { label: 'undo', onAction: vi.fn() }));
    expect(toasts()).toHaveLength(2);
    act(() => vi.advanceTimersByTime(3600));
    expect(toasts()).toHaveLength(1);
    expect(document.querySelector('.toast-undo')).not.toBeNull();
    act(() => vi.advanceTimersByTime(3400));
    expect(toasts()).toHaveLength(0);
  });

  it('pauses the countdown while focused and resumes the remaining time on blur', () => {
    act(() => api.notify('with undo', 'info', { label: 'undo', onAction: vi.fn() }));
    act(() => vi.advanceTimersByTime(5000));
    const undo = document.querySelector('.toast-undo') as HTMLButtonElement;
    act(() => undo.focus());
    act(() => vi.advanceTimersByTime(10_000));
    expect(toasts()).toHaveLength(1);
    act(() => undo.blur());
    act(() => vi.advanceTimersByTime(1999));
    expect(toasts()).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));
    expect(toasts()).toHaveLength(0);
  });

  it('dismisses via the close button without running the action', () => {
    const onAction = vi.fn();
    act(() => api.notify('with undo', 'info', { label: 'undo', onAction }));
    const close = document.querySelector('.toast-close') as HTMLButtonElement;
    act(() => close.click());
    expect(onAction).not.toHaveBeenCalled();
    expect(toasts()).toHaveLength(0);
  });
});