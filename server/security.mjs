// Security helpers: loopback token checks, repo-relative path validation,
// realpath escape prevention and sensitive-file masking.
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

const SENSITIVE_EXACT = new Set(['.env', '.netrc', '.git-credentials', '.npmrc']);
const SENSITIVE_PREFIXES = ['.env.', 'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519'];
const SENSITIVE_SUFFIXES = ['.key', '.pem', '.p12', '.pfx'];

export function isSensitivePath(p) {
  const segments = String(p).split(/[\\/]/);
  const base = (segments[segments.length - 1] || '').toLowerCase();
  if (!base) return false;
  return SENSITIVE_EXACT.has(base)
    || SENSITIVE_PREFIXES.some((x) => base.startsWith(x))
    || SENSITIVE_SUFFIXES.some((x) => base.endsWith(x));
}

// Normalize a repo-relative path. Rejects absolute paths, NUL bytes,
// dot segments and empty segments. Returns null on anything unsafe.
export function normalizeRepoPath(input) {
  if (typeof input !== 'string' || !input) return null;
  if (input.includes('\0')) return null;
  if (input.startsWith('/') || input.startsWith('\\')) return null;
  if (/\/\//.test(input) || /\\\\/.test(input)) return null;
  if (/^[A-Za-z]:/.test(input)) return null;
  const parts = [];
  for (const segment of input.split(/[\\/]+/)) {
    if (!segment || segment === '.') return null;
    if (segment === '..') return null;
    // The .git directory holds credentials (remote URLs with embedded tokens)
    // and hooks; the UI must never read or write inside it.
    if (segment.toLowerCase() === '.git') return null;
    parts.push(segment);
  }
  return parts.length ? parts.join('/') : null;
}

// Resolve rel inside root and verify via realpath that symlinks cannot
// escape the repo root. Missing leaves (e.g. just-deleted files) are walked
// upwards so the check still covers the existing parent directories.
export async function resolveInside(root, rel) {
  const norm = normalizeRepoPath(rel);
  if (!norm) return null;
  const abs = path.resolve(root, norm);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  // A registered repository path may itself be a symlink (e.g. /tmp on macOS
  // resolves to /private/tmp). Compare against the real root as well, so
  // legitimate files are not rejected just because the roots differ.
  const rootReal = await fsp.realpath(root).catch(() => null);
  const insideRoot = (p) =>
    p === root
    || p.startsWith(root + path.sep)
    || (!!rootReal && (p === rootReal || p.startsWith(rootReal + path.sep)));
  let current = abs;
  const missing = [];
  for (;;) {
    try {
      const real = await fsp.realpath(current);
      if (!insideRoot(real)) return null;
      return path.join(real, ...missing.reverse());
    } catch (err) {
      if (err.code !== 'ENOENT') return null;
      missing.push(path.basename(current));
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

// Validate a user-supplied ref name (branch/tag). Git rejects invalid names
// itself; this is defence in depth so a value can never be parsed as an
// option and cannot contain control characters.
export function validateRefName(name) {
  if (typeof name !== 'string') return false;
  const v = name.trim();
  if (!v || v.startsWith('-') || v.includes('\0')) return false;
  if (/[\s~^:?*[\\\]]/.test(v)) return false;
  if (v.includes('..') || v.endsWith('/') || v.endsWith('.')) return false;
  return v.length <= 256 ? v : false;
}

// Accept only network transport for cloning: http(s), ssh, git and the
// scp-like "user@host:path" form. Reject file:// and local paths.
export function validateCloneUrl(raw) {
  if (typeof raw !== 'string') return false;
  const url = raw.trim();
  if (!url || url.length > 500 || url.includes('\0') || /\s/.test(url) || url.startsWith('-')) {
    return false;
  }
  if (/^https?:\/\//i.test(url) || /^ssh:\/\//i.test(url) || /^git:\/\//i.test(url)) return true;
  if (/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[\w./-]+$/.test(url)) return true;
  return false;
}

// A single safe path component for a new directory.
export function validateFolderName(raw) {
  if (typeof raw !== 'string') return false;
  const name = raw.trim();
  if (!name || name === '.' || name === '..' || name.length > 128) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) ? name : false;
}

// Audit entries must never receive credentials or query-string tokens from a
// clone URL. Keep the host/path, drop userinfo and the query.
export function sanitizeUrlForAudit(raw) {
  const value = String(raw || '');
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    // scp-like `user@host:path` has no password; still strip a query string.
    return value.replace(/\/\/[^/@]+@/, '//***@').replace(/\?.*$/, '');
  }
}

export function randomToken() {
  return crypto.randomBytes(24).toString('hex');
}

// Strip credentials from URLs embedded in arbitrary text. git stderr can echo
// a remote URL whose userinfo carries a token; this must never reach the client.
export function redactCredentials(text) {
  return String(text || '').replace(/((?:https?|ssh|git):\/\/)[^/\s@]+@/gi, '$1***@');
}
