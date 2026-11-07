import { useEffect, useRef } from 'react';

// Escape handlers form a stack: only the dialog opened last reacts, so pressing
// Escape while a confirmation sits on top of a modal closes the confirmation
// instead of closing both layers at once.
const stack: symbol[] = [];

// Run a handler whenever Escape is pressed. Used to close modal dialogs.
export function useEscape(onClose: () => void, enabled = true) {
  const tokenRef = useRef<symbol>(Symbol('escape'));
  // Keep the latest callback without re-registering: re-registering on every
  // render would move this dialog to the top of the stack even when another
  // dialog was opened above it.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!enabled) return;
    const token = tokenRef.current;
    stack.push(token);
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (stack[stack.length - 1] !== token) return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const index = stack.lastIndexOf(token);
      if (index !== -1) stack.splice(index, 1);
    };
  }, [enabled]);
}
