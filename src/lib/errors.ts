import { t } from '../i18n';

/** Normalize an unknown thrown value into a displayable message. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return localizeAuthError(err.message);
  if (typeof err === 'string') return localizeAuthError(err);
  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string') return localizeAuthError(message);
  }
  return '';
}

// The server's admin gate deliberately keeps the wire error terse
// ("admin access required"). That is fine for an API client but useless in a
// toast: it does not say who can do the action or how to get access.
const ADMIN_REQUIRED_RE = /\badmin access required\b/i;

function localizeAuthError(message: string): string {
  if (!ADMIN_REQUIRED_RE.test(message)) return message;
  return t('Only team admins can perform this action. Ask the owner to promote your account in Team, or sign in with the owner account.');
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
