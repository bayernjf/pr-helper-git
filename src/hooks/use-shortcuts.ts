import { useEffect } from 'react';
import { useApp } from '../app-state';

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT'
    || tag === 'TEXTAREA'
    || tag === 'SELECT'
    || el.isContentEditable;
}

// Global keyboard shortcuts. Plain-key shortcuts are ignored while a form
// field is focused so they never interfere with typing.
export function useShortcuts() {
  const { setView, refresh, activeRepo, view } = useApp();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (mod && key === '1') {
        event.preventDefault();
        setView('git');
        return;
      }
      if (mod && key === '2') {
        event.preventDefault();
        setView('pr');
        return;
      }
      if (mod && event.shiftKey && key === 'f') {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('.graph-search input')?.focus();
        return;
      }
      if (!mod && !event.altKey && key === 'r' && !isEditable(event.target) && activeRepo) {
        event.preventDefault();
        refresh().catch(() => {});
      }
      // "?" opens the shortcut reference (Shift+/ produces "?"); ignored while
      // typing so it never interferes with form entry.
      if (!mod && !event.altKey && event.key === '?' && !isEditable(event.target)) {
        event.preventDefault();
        window.dispatchEvent(new Event('git2:shortcuts'));
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setView, refresh, activeRepo, view]);
}
