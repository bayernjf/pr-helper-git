// Desktop (WKWebView) native folder picker bridge. The Swift shell registers
// a `folderPicker` script-message handler that opens NSOpenPanel and resolves
// the pending promise with the chosen absolute path — null when cancelled.
// Plain browsers have no bridge: callers fall back to the manual path input.

let pending: ((path: string | null) => void) | null = null;

interface MessageHandlerHost {
  webkit?: { messageHandlers?: Record<string, { postMessage(payload: unknown): void }> };
  __resolveFolderPicker?: (value: string | null) => void;
}

const host = () => window as unknown as MessageHandlerHost;

export function folderPickerAvailable(): boolean {
  return typeof window !== 'undefined' && !!host().webkit?.messageHandlers?.folderPicker;
}

export function pickFolder(): Promise<string | null> {
  const handler = host().webkit?.messageHandlers?.folderPicker;
  if (!handler) return Promise.resolve(null);
  return new Promise((resolve) => {
    pending = resolve;
    // Swift evaluates this after the panel closes: path string, or null on cancel.
    host().__resolveFolderPicker = (value) => {
      const done = pending;
      pending = null;
      done?.(value);
    };
    handler.postMessage({ kind: 'pickFolder' });
  });
}
