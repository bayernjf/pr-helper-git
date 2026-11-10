// @vitest-environment jsdom
// The shared interaction layer is the contract both clients rely on: toasts
// carry a kind icon and an alert/status role, confirmations label themselves
// and distinguish destructive from neutral actions.
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider, ToastProvider, useConfirm, useToast } from './ui';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.replaceChildren();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

function mount(node: React.ReactNode) {
  act(() => root!.render(
    createElement(ToastProvider, null, createElement(ConfirmProvider, null, node)),
  ));
}

function ToastHarness() {
  const toast = useToast();
  return createElement('button', { onClick: () => toast.error('disk full') }, 'show');
}

function ConfirmHarness({ danger, confirmLabel }: { danger: boolean; confirmLabel: string }) {
  const confirm = useConfirm();
  return createElement(
    'button',
    {
      onClick: async () => {
        const result = await confirm({
          title: 'Delete file?',
          detail: 'This cannot be undone.',
          confirmLabel,
          danger,
        });
        const out = document.createElement('span');
        out.id = 'confirm-result';
        out.textContent = String(result);
        document.body.append(out);
      },
    },
    'ask',
  );
}

describe('toast contract', () => {
  it('renders the kind class, an icon and an alert role for errors', () => {
    mount(createElement(ToastHarness));
    act(() => (host.querySelector('button') as HTMLButtonElement).click());

    const item = document.querySelector('.toast.toast-error') as HTMLElement;
    expect(item).not.toBeNull();
    expect(item.getAttribute('role')).toBe('alert');
    expect(item.querySelector('.toast-icon svg')).not.toBeNull();
  });
});

describe('confirm contract', () => {
  it('labels the dialog and uses a danger button for destructive actions', () => {
    mount(createElement(ConfirmHarness, { danger: true, confirmLabel: 'Delete' }));
    act(() => (host.querySelector('button') as HTMLButtonElement).click());

    const dialog = document.querySelector('.modal-backdrop') as HTMLElement;
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-labelledby')).toBe('confirm-dialog-title');
    expect(dialog.getAttribute('aria-describedby')).toBe('confirm-dialog-detail');
    expect(dialog.querySelector('.btn-danger')?.textContent).toBe('Delete');
  });

  it('uses the primary button for a neutral action and resolves false on Cancel', async () => {
    mount(createElement(ConfirmHarness, { danger: false, confirmLabel: 'Continue' }));
    act(() => (host.querySelector('button') as HTMLButtonElement).click());

    const dialog = document.querySelector('.modal-backdrop') as HTMLElement;
    expect(dialog.querySelector('.btn-danger')).toBeNull();
    expect(dialog.querySelector('.btn-primary')?.textContent).toBe('Continue');

    await act(async () => {
      (dialog.querySelector('.modal-footer .btn') as HTMLButtonElement).click();
    });
    expect(document.querySelector('#confirm-result')?.textContent).toBe('false');
  });
});
