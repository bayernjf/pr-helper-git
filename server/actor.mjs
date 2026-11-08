// Per-request identity context. Handlers deep inside the route modules call
// appendAudit() without receiving the request object, so the authenticated
// member travels through AsyncLocalStorage instead of being threaded through
// every signature.
import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

export function runAsActor(identity, fn) {
  return storage.run(identity, fn);
}

export function currentActor() {
  return storage.getStore() || null;
}
