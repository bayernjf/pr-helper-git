// Thin API client. In dev the Vite proxy injects the loopback token; in
// production the HttpOnly cookie authenticates same-origin requests.

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { cache: 'no-store', ...init });
  } catch (err) {
    throw new ApiError(0, 'network error — is the local server running?', String(err));
  }
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    /* non-JSON response */
  }
  if (!response.ok) {
    const body = payload && typeof payload === 'object'
      ? payload as { error?: unknown; detail?: unknown }
      : {};
    throw new ApiError(
      response.status,
      typeof body.error === 'string' ? body.error : `HTTP ${response.status}`,
      typeof body.detail === 'string' ? body.detail : undefined,
    );
  }
  return payload as T;
}

export function post(path: string, body: unknown) {
  return request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
