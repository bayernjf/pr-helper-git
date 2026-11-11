/** Normalize an unknown thrown value into a displayable message. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return '';
}

/** Optional `detail` field returned by the local API. */
export function errorDetail(err: unknown): string {
  if (err && typeof err === 'object' && 'detail' in err) {
    const detail = (err as { detail?: unknown }).detail;
    return typeof detail === 'string' ? detail : '';
  }
  return '';
}

/** Optional HTTP status attached to an API error. */
export function errorStatus(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status?: unknown }).status;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}
