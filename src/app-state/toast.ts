import { useCallback } from 'react';
import { useToast, type ToastKind } from '../components/ui';

// Compatibility hook: keep the `toast(message, kind)` call shape of the old
// `AppData.toast` while letting consumers subscribe only to ToastContext
// instead of the whole AppData aggregate.
export function useAppToast() {
  const api = useToast();
  return useCallback(
    (message: string, kind: ToastKind = 'info') => api.notify(message, kind),
    [api],
  );
}
