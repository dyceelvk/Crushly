import { Router } from 'express';
import { getDb, now } from '../db.js';
import { config } from '../config.js';
import { requireAuth } from '../auth.js';
import { HttpError, handle } from '../errors.js';
import * as v from '../lib/validate.js';
import {
  ensureConversation, isBlockedEitherWay, isConnected, messagingBlockReason, notify, photosFor,
} from '../lib/social.js';
import { imageUpload, publicUrlFor, removeUploadedFile } from '../uploads.js';

export const momentsRouter = Router();
momentsRouter.use(requireAuth);

export const MOMENT_STYLES = ['noir', 'champagne', 'crimson', 'midnight', 'emerald'];
export const MOMENT_REACTIONS = ['crush', 'fire', 'laugh', 'wow', 'clap'];

function canSee(moment, viewerId) {
  if (moment.user_id === viewerId) return true;
  if (moment.expires_at <= now()) return false;
  if (isBlockedEitherWay(viewerId, moment.user_id)) return false;
  if (moment.audience === 'connections' && !isConnected(viewerId, moment.user_id)) return false;
  const owner = getDb()
    .prepare(
      `SELECT u.status, p.onboarded, pr.profile_visibility FROM users u JOIN profiles p ON p.user_id = u.id
         JOIN privacy pr ON pr.user_id = u.id WHERE u.id = ?`,
    )
    .get(moment.user_id);
  if (!owner || owner.status !== 'active' || !owner.onboarded) return false;
  if (owner.profile_visibility === 'connections' && !isConnected(viewerId, moment.user_id)) return false;
  return true;
}

function serializeMoment(m, viewerId) {
  const db = getDb();
  const mine = m.user_id === viewerId;
  const base = {
    id: m.id,
    userId: m.user_id,
    kind: m.kind,
    body: m.body,
    mediaUrl: m.media_url,
    style: m.style,
    audience: m.audience,
    createdAt: m.created_at,
    expiresAt: m.expires_at,
    seen: !!db.prepare('SELECT 1 FROM moment_views WHERE moment_id = ? AND user_id = ?').get(m.id, viewerId),
    myReaction: db.prepare('SELECT kind FROM moment_reactions WHERE moment_id = ? AND user_id = ?').get(m.id, viewerId)?.kind || null,
  };
  if (mine) {
    base.viewCount = db.prepare('SELECT COUNT(*) AS n FROM moment_views WHERE moment_id = ? AND user_id != ?').get(m.id, viewerId).n;
    base.reactions = db
      .prepare(
        `SELECT r.kind, r.user_id AS userId, p.name FROM moment_reactions r JOIN profiles p ON p.user_id = r.user_id
          WHERE r.moment_id = ? ORDER BY r.created_at DESC LIMIT 50`,
      )
      .all(m.id);
  }
  return base;
}

function author(userId, viewerId) {
  const p = getDb().prepare('SELECT name, verification FROM profiles WHERE user_id = ?').get(userId);
  return {
    id: userId,
    name: p?.name || 'Member',
    verified: p?.verification === 'verified',
    photo: photosFor(userId)[0]?.url || null,
    mutual: userId !== viewerId && isConnected(viewerId, userId),
  };
}

/** Feed grouped by member: yours first, then unseen, Mutual Crushes before everyone else. */
momentsRouter.get(
  '/moments',
  handle((req, res) => {
    const me = req.user.id;
    const db = getDb();
    const rows = db.prepare('SELECT * FROM moments WHERE expires_at > ? ORDER BY created_at ASC').all(now());
    const groups = new Map();
    for (const m of rows) {
      if (!canSee(m, me)) continue;
      if (!groups.has(m.user_id)) groups.set(m.user_id, []);
      groups.get(m.user_id).push(serializeMoment(m, me));
    }
    const mine = groups.get(me) || [];
    groups.delete(me);
    const others = [...groups.entries()].map(([userId, moments]) => ({
      user: author(userId, me),
      moments,
      hasUnseen: moments.some((m) => !m.seen),
      latestAt: moments[moments.length - 1].createdAt,
    }));
    others.sort(
      (a, b) =>
        Number(b.hasUnseen) - Number(a.hasUnseen) ||
        Number(b.user.mutual) - Number(a.user.mutual) ||
        b.latestAt - a.latestAt,
    );
    res.json({ mine: { user: author(me, me), moments: mine }, others });
  }),
);

momentsRouter.post(
  '/moments',
  imageUpload.single('photo'),
  handle((req, res) => {
    const me = req.user.id;
    const kind = req.file ? 'photo' : 'text';
    let body;
    let style;
    let audience;
    try {
      body = v.str(req.body?.body, kind === 'text' ? 'Your Moment' : 'Caption', { required: kind === 'text', max: kind === 'text' ? 280 : 200 });
      style = v.oneOf(req.body?.style || 'noir', 'Style', MOMENT_STYLES);
      audience = v.oneOf(req.body?.audience || 'everyone', 'Audience', ['everyone', 'connections']);
    } catch (err) {
      if (req.file) removeUploadedFile(publicUrlFor(req.file));
      throw err;
    }
    const t = now();
    const info = getDb()
      .prepare('INSERT INTO moments (user_id, kind, body, media_url, style, audience, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(me, kind, body, req.file ? publicUrlFor(req.file) : null, style, audience, t, t + config.momentLifetimeMs);
    const m = getDb().prepare('SELECT * FROM moments WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(serializeMoment(m, me));
  }),
);

function visibleMoment(req) {
  const m = getDb().prepare('SELECT * FROM moments WHERE id = ?').get(Number(req.params.id));
  if (!m || !canSee(m, req.user.id)) throw new HttpError(404, 'This Moment has passed.');
  return m;
}

momentsRouter.delete(
  '/moments/:id',
  handle((req, res) => {
    const m = getDb().prepare('SELECT * FROM moments WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
    if (!m) throw new HttpError(404, 'Moment not found.');
    getDb().prepare('DELETE FROM moments WHERE id = ?').run(m.id);
    removeUploadedFile(m.media_url);
    res.json({ ok: true });
  }),
);

momentsRouter.post(
  '/moments/:id/view',
  handle((req, res) => {
    const m = visibleMoment(req);
    if (m.user_id !== req.user.id) {
      getDb().prepare('INSERT OR IGNORE INTO moment_views (moment_id, user_id, created_at) VALUES (?, ?, ?)').run(m.id, req.user.id, now());
    }
    res.json({ ok: true });
  }),
);

momentsRouter.post(
  '/moments/:id/react',
  handle((req, res) => {
    const m = visibleMoment(req);
    const me = req.user.id;
    if (m.user_id === me) throw new HttpError(400, 'You can’t react to your own Moment.');
    const kind = req.body?.kind == null ? null : v.oneOf(req.body.kind, 'Reaction', MOMENT_REACTIONS);
    const db = getDb();
    if (!kind) {
      db.prepare('DELETE FROM moment_reactions WHERE moment_id = ? AND user_id = ?').run(m.id, me);
    } else {
      const had = db.prepare('SELECT kind FROM moment_reactions WHERE moment_id = ? AND user_id = ?').get(m.id, me);
      db.prepare('INSERT OR REPLACE INTO moment_reactions (moment_id, user_id, kind, created_at) VALUES (?, ?, ?, ?)').run(m.id, me, kind, now());
      if (!had) notify(m.user_id, 'moment_reaction', { actorId: me, refId: m.id, body: kind });
    }
    res.json(serializeMoment(m, me));
  }),
);

/** Replying to a Moment sends a private message that quotes it. */
momentsRouter.post(
  '/moments/:id/reply',
  handle((req, res) => {
    const m = visibleMoment(req);
    const me = req.user.id;
    if (m.user_id === me) throw new HttpError(400, 'You can’t reply to your own Moment.');
    const body = v.str(req.body?.body, 'Reply', { required: true, max: 1000 });
    const reason = messagingBlockReason(me, m.user_id);
    if (reason) throw new HttpError(403, reason, 'messaging_restricted');
    const conv = ensureConversation(me, m.user_id);
    const t = now();
    const meta = { momentId: m.id, momentKind: m.kind, momentBody: m.body.slice(0, 120), momentMedia: m.media_url, momentStyle: m.style };
    getDb()
      .prepare("INSERT INTO messages (conversation_id, sender_id, kind, body, meta, created_at) VALUES (?, ?, 'moment_reply', ?, ?, ?)")
      .run(conv.id, me, body, JSON.stringify(meta), t);
    getDb().prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?').run(t, conv.id);
    notify(m.user_id, 'moment_reply', { actorId: me, refId: conv.id, body: body.slice(0, 80) });
    res.status(201).json({ conversationId: conv.id });
  }),
);

