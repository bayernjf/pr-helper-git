// Node ≥22 exposes a lazy experimental globalThis.localStorage that resolves
// to undefined without --localstorage-file (Node 26 prints the
// ExperimentalWarning). In the vitest jsdom environment that undefined value
// SHADOWS jsdom's own window.localStorage, so any test touching localStorage
// dies with "Cannot read properties of undefined". Install a small in-memory
// implementation whenever the real one is missing. Applies to both the node
// and jsdom environments; harmless where a real implementation exists.
if (typeof localStorage === 'undefined') {
  const store = new Map<string, string>();
  const api = {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index: number) => {
      const keys = [...store.keys()];
      return index >= 0 && index < keys.length ? keys[index] : null;
    },
    get length() { return store.size; },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: api, configurable: true, writable: true });
  try {
    Object.defineProperty(window, 'localStorage', { value: api, configurable: true, writable: true });
  } catch { /* window not present in the node environment */ }
}
