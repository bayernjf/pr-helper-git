// Page-entry snapshot cache. The five top-level pages unmount on navigation,
// so their local state is discarded and the next entry would otherwise paint
// an empty board until the network answers. Each page seeds its state from the
// last successful payload and replaces it once the fresh one lands.

const snapshots = new Map<string, unknown>();

export function peekSnapshot<T>(key: string): T | null {
  return (snapshots.get(key) as T | undefined) ?? null;
}

export function putSnapshot<T>(key: string, value: T): void {
  snapshots.set(key, value);
}

export function clearSnapshot(key: string): void {
  snapshots.delete(key);
}
