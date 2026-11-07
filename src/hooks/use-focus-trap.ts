import { useEffect } from 'react';

// Focusable elements, excluding disabled and explicitly removed controls.
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function topBackdrop(): HTMLElement | null {
  const list = document.querySelectorAll<HTMLElement>('.modal-backdrop');
  return list.length ? list[list.length - 1] : null;
}

function focusableInside(backdrop: HTMLElement): HTMLElement[] {
  return Array.from(backdrop.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter((el) => el.offsetParent !== null || el === document.activeElement);
}

function insideBackdrop(el: HTMLElement): boolean {
  return !!el.closest('.modal-backdrop');
}

// Mounted once at the app root. Whenever a modal is open, focus moves into it,
// Tab is trapped inside (with wrap-around), and focus returns to the opener
// when the modal closes. Works for every existing .modal-backdrop without
// requiring changes to individual modal components.
export function useFocusTrap() {
  useEffect(() => {
    let activeBackdrop: HTMLElement | null = null;
    // Track the most recently focused element outside any modal. The modal
    // may auto-focus its own input before the mount observer runs, so reading
    // document.activeElement at mount time cannot reliably find the opener.
    let opener: HTMLElement | null = null;

    function onFocusIn(event: FocusEvent) {
      const el = event.target as HTMLElement;
      if (el && !insideBackdrop(el)) opener = el;
    }

    function moveFocusIn(backdrop: HTMLElement) {
      const focusable = focusableInside(backdrop);
      if (focusable.length) {
        focusable[0].focus();
      } else {
        backdrop.setAttribute('tabindex', '-1');
        backdrop.focus();
      }
    }

    function reconcile() {
      const current = topBackdrop();
      if (current === activeBackdrop) return;

      if (current) {
        activeBackdrop = current;
        moveFocusIn(current);
      } else {
        activeBackdrop = null;
        // If another modal is still open (nested dialog just closed), return
        // focus to it; otherwise restore the original opener.
        const remaining = topBackdrop();
        if (remaining) {
          moveFocusIn(remaining);
        } else if (opener && document.contains(opener)) {
          opener.focus();
          opener = null;
        }
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab' || !activeBackdrop) return;
      const focusable = focusableInside(activeBackdrop);
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (active === first || !activeBackdrop.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !activeBackdrop.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }

    const observer = new MutationObserver(() => reconcile());
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('keydown', onKeyDown, true);
    reconcile();

    return () => {
      observer.disconnect();
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, []);
}
