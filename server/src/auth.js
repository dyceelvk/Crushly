import crypto from 'node:crypto';
import { getDb, now } from './db.js';
import { HttpError } from './errors.js';

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltB64, keyB64] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, SCRYPT_PARAMS);
  return crypto.timingSafeEqual(expected, actual);
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

/** Creates an opaque session token. Only its hash is stored, so a DB leak can't be replayed. */
export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const t = now();
  getDb()
    .prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_used_at) VALUES (?, ?, ?, ?)')
    .run(sha256(token), userId, t, t);
  return token;
}

export function destroySession(token) {
  getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function destroyAllSessions(userId, exceptToken) {
  if (exceptToken) {
    getDb().prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, sha256(exceptToken));
  } else {
    getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
}

function readToken(req) {
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/** Express middleware: resolves the session and attaches `req.user` / `req.token`. */
export function requireAuth(req, _res, next) {
  const token = readToken(req);
  if (!token) return next(new HttpError(401, 'Please sign in to continue.'));
  const db = getDb();
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.status, u.plus_interest, u.created_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`,
    )
    .get(sha256(token));
  if (!row) return next(new HttpError(401, 'Your session has ended. Please sign in again.'));
  const t = now();
  db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(t, row.id);
  db.prepare('UPDATE sessions SET last_used_at = ? WHERE token_hash = ?').run(t, sha256(token));
  req.user = row;
  req.token = token;
  next();
}

/** Minimal fixed-window rate limiter for sensitive endpoints (auth, reports). */
export function rateLimit({ windowMs, max, message }) {
  const hits = new Map();
  return (req, _res, next) => {
    const key = `${req.ip}:${req.path}`;
    const t = Date.now();
    const entry = hits.get(key);
    if (!entry || t - entry.start > windowMs) {
      hits.set(key, { start: t, count: 1 });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) return next(new HttpError(429, message || 'Too many attempts. Try again in a moment.'));
    next();
  };
}
