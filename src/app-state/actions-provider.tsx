import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { errorMessage, errorDetail } from '../lib/errors';
import { useToast } from '../components/ui';
import { t as translateText } from '../i18n';
import type { Actions } from './types';
import { useRepoRegistry } from './repo-provider';

export const ActionsContext = createContext<Actions | null>(null);
export const BusyContext = createContext<boolean>(false);

export function ActionsProvider({ children }: { children: ReactNode }) {
  const toastApi = useToast();
  const { refresh } = useRepoRegistry();
  const [busy, setBusy] = useState(false);

  // Keep the latest refresh in a ref so runAction has a stable identity: it no
  // longer re-creates when activeRepo or log options change, and it never
  // reads a stale refresh closure.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  // Run a write action, then refresh all data. Errors are surfaced as toasts.
  const runAction = useCallback(async <T,>(action: Promise<T>, successMessage?: string) => {
    setBusy(true);
    try {
      const result = await action;
      await refreshRef.current();
      if (successMessage) toastApi.notify(successMessage, 'success');
      return result;
    } catch (err) {
      // A failed write can still change the repository (conflicted merge,
      // revert or rebase), so reload before reporting the error; otherwise
      // the operation banner and unmerged files would not appear.
      try { await refreshRef.current(); } catch { /* surfaced by the original error */ }
      const message = errorDetail(err)
        ? `${translateText(errorMessage(err) || 'action failed')}: ${errorDetail(err)}`
        : translateText(errorMessage(err) || 'action failed');
      toastApi.error(message);
      return null;
    } finally {
      setBusy(false);
    }
  }, [toastApi]);

  const actions = useMemo<Actions>(() => ({ runAction }), [runAction]);

  return (
    <ActionsContext.Provider value={actions}>
      <BusyContext.Provider value={busy}>
        {children}
      </BusyContext.Provider>
    </ActionsContext.Provider>
  );
}

export function useRunAction(): Actions {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error('useRunAction must be used inside ActionsProvider');
  return ctx;
}

export function useBusy(): boolean {
  return useContext(BusyContext);
}
