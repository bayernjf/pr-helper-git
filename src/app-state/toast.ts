import { useCallback } from 'react';
import { useToast, type ToastKind } from '../components/ui';

// Toast domain hook: expose `notify` with the `toast(message, kind)` call shape
// so consumers subscribe only to ToastContext instead of a broader app state.
export function useAppToast() {
  const api = useToast();
  return useCallback(
    (message: string, kind: ToastKind = 'info') => api.notify(message, kind),
    [api],
  );
}
