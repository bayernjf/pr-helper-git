import { useEffect } from 'react';

// Run a handler whenever Escape is pressed. Used to close modal dialogs.
export function useEscape(onClose: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, enabled]);
}
