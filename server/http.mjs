// Shared response envelope for the local HTTP route handlers.
// Every handler returns either { status, json } or null (route did not match).
export const ok = (json, status = 200) => ({ status, json });

export const fail = (status, error, detail) => ({
  status,
  json: { error, ...(detail ? { detail } : {}) },
});
