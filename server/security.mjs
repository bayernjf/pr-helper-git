// Security helpers: loopback token checks, repo-relative path validation,
// realpath escape prevention and sensitive-file masking.
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

const SENSITIVE_EXACT = new Set(['.env']);
const SENSITIVE_PREFIXES = ['.env.', 'id_rsa'];
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
  let current = abs;
  const missing = [];
  for (;;) {
    try {
      const real = await fsp.realpath(current);
      if (real !== root && !real.startsWith(root + path.sep)) return null;
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

export function createTokenChecker(expected) {
  const b = Buffer.from(String(expected));
  return function tokenOk(given) {
    if (!given) return false;
    const a = Buffer.from(String(given).replace(/^Bearer\s+/i, '').trim());
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };
}

export function randomToken() {
  return crypto.randomBytes(24).toString('hex');
}
