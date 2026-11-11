// Local team identity. The instance token printed at startup belongs to the
// owner (admin). Additional members get their own random token, stored only as
// a SHA-256 hash in config.json. Tokens are shown once, at creation time.
import crypto from 'node:crypto';
import { loadConfig, updateConfig } from './store.mjs';

export const USER_NAME_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/i;
export const ROLES = ['admin', 'member'];

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function sameToken(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function ownerIdentity(config = {}) {
  return { name: config.ownerName || 'owner', role: 'admin', instance: true };
}

// Resolve a presented token to an identity. The instance token always maps to
// the owner; member tokens are matched against stored hashes.
export async function resolveToken(presented, instanceToken) {
  if (!presented) return null;
  const token = String(presented).replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const config = await loadConfig();
  if (sameToken(token, instanceToken)) return ownerIdentity(config);
  const hash = hashToken(token);
  const user = config.users.find((u) => sameToken(hash, u.tokenHash || ''));
  if (!user) return null;
  return { name: user.name, role: user.role === 'admin' ? 'admin' : 'member', instance: false };
}

export async function listUsers() {
  const config = await loadConfig();
  return {
    owner: ownerIdentity(config),
    users: config.users.map((u) => ({
      name: u.name,
      role: u.role === 'admin' ? 'admin' : 'member',
      createdAt: u.createdAt || null,
    })),
  };
}

/**
 * @param {string} name
 * @param {'member'|'admin'} role
 * @returns {Promise<{error: string} | {user: {name: string, role: string, createdAt: string}, token: string}>}
 */
export async function createUser(name, role) {
  const cleanName = typeof name === 'string' ? name.trim() : '';
  if (!USER_NAME_RE.test(cleanName)) {
    return { error: 'invalid user name (2-32 chars: letters, digits, _ or -)' };
  }
  if (!ROLES.includes(role)) return { error: 'role must be "admin" or "member"' };
  return updateConfig((config) => {
    if (ownerIdentity(config).name.toLowerCase() === cleanName.toLowerCase()) {
      return { persist: false, value: { error: 'name is reserved for the owner' } };
    }
    if (config.users.some((u) => u.name.toLowerCase() === cleanName.toLowerCase())) {
      return { persist: false, value: { error: 'user already exists' } };
    }
    const token = crypto.randomBytes(24).toString('hex');
    const user = {
      name: cleanName,
      role,
      tokenHash: hashToken(token),
      createdAt: new Date().toISOString(),
    };
    config.users.push(user);
    // The plaintext token is returned exactly once; only its hash is persisted.
    return { value: { user: { name: user.name, role: user.role, createdAt: user.createdAt }, token } };
  });
}

/**
 * @param {string} name
 * @returns {Promise<{error: string} | {name: string, role: string}>}
 */
export async function removeUser(name) {
  const cleanName = typeof name === 'string' ? name.trim() : '';
  if (!cleanName) return { error: 'missing user name' };
  return updateConfig((config) => {
    const index = config.users.findIndex((u) => u.name === cleanName);
    if (index === -1) return { persist: false, value: { error: 'user not found' } };
    config.users.splice(index, 1);
    return { value: { ok: true, name: cleanName } };
  });
}
