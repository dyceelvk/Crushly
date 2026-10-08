import { Router } from 'express';
import { getDb, now, tx } from '../db.js';
import { createSession, destroySession, hashPassword, rateLimit, requireAuth, verifyPassword } from '../auth.js';
import { HttpError, handle } from '../errors.js';
import * as v from '../lib/validate.js';
import { serializeMe } from './me.js';

export const authRouter = Router();

const authLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, message: 'Too many attempts. Take a breath and try again in a few minutes.' });

export function createAccount(emailInput, passwordInput, extra = {}) {
  const email = v.email(emailInput);
  const password = v.password(passwordInput);
  const db = getDb();
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    throw new HttpError(409, 'An account with this email already exists. Try signing in.');
  }
  return tx(() => {
    const t = now();
    const info = db
      .prepare('INSERT INTO users (email, password_hash, is_demo, created_at, last_active_at) VALUES (?, ?, ?, ?, ?)')
      .run(email, hashPassword(password), extra.isDemo ? 1 : 0, t, t);
    const id = Number(info.lastInsertRowid);
    db.prepare('INSERT INTO profiles (user_id, updated_at) VALUES (?, ?)').run(id, t);
    db.prepare('INSERT INTO preferences (user_id) VALUES (?)').run(id);
    db.prepare('INSERT INTO privacy (user_id) VALUES (?)').run(id);
    db.prepare('INSERT INTO notification_settings (user_id) VALUES (?)').run(id);
    return id;
  });
}

authRouter.post(
  '/signup',
  authLimiter,
  handle((req, res) => {
    const id = createAccount(req.body?.email, req.body?.password);
    const token = createSession(id);
    res.status(201).json({ token, me: serializeMe(id) });
  }),
);

authRouter.post(
  '/login',
  authLimiter,
  handle((req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) throw new HttpError(400, 'Enter your email and password.');
    const user = getDb().prepare('SELECT id, password_hash, status FROM users WHERE email = ?').get(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, 'That email and password don’t match.');
    }
    // Signing back in un-pauses a paused account.
    if (user.status === 'paused') getDb().prepare("UPDATE users SET status = 'active' WHERE id = ?").run(user.id);
    const token = createSession(user.id);
    res.json({ token, me: serializeMe(user.id) });
  }),
);

authRouter.post(
  '/logout',
  requireAuth,
  handle((req, res) => {
    destroySession(req.token);
    res.json({ ok: true });
  }),
);
