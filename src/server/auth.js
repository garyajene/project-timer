import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const SESSION_SECONDS = 60 * 60 * 24 * 14;
export const SESSION_COOKIE = 'project_timer_session';

export function normalizeEmail(value) { return String(value ?? '').trim().toLowerCase(); }

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw new TypeError('Password must be between 12 and 1024 characters');
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$32768$8$1$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`;
}

export async function verifyPassword(password, encoded) {
  try {
    const [algorithm, n, r, p, saltText, hashText] = String(encoded).split('$');
    if (algorithm !== 'scrypt') return false;
    const expected = Buffer.from(hashText, 'base64url');
    const actual = Buffer.from(await scrypt(String(password), Buffer.from(saltText, 'base64url'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 }));
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch { return false; }
}

export function hashSessionToken(token) { return createHash('sha256').update(token).digest('base64url'); }
export function parseCookies(header = '') {
  const cookies = {};
  for (const item of header.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 1) continue;
    try { cookies[decodeURIComponent(item.slice(0, separator).trim())] = decodeURIComponent(item.slice(separator + 1).trim()); } catch { /* Ignore malformed cookies. */ }
  }
  return cookies;
}

export async function issueSession(store, userId) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  await store.createSession({ id: randomUUID(), userId, tokenHash: hashSessionToken(token), expiresAt });
  return token;
}

export function sessionCookie(token, secure = process.env.NODE_ENV === 'production') {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; ${secure ? 'Secure; ' : ''}SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}`;
}
export function clearSessionCookie(secure = process.env.NODE_ENV === 'production') { return `${SESSION_COOKIE}=; HttpOnly; ${secure ? 'Secure; ' : ''}SameSite=Lax; Path=/; Max-Age=0`; }

export async function authenticate(request, store) {
  const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
  return token ? store.getSession(hashSessionToken(token)) : null;
}
