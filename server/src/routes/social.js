import { Router } from 'express';
import { getDb, now, parseJson, tx } from '../db.js';
import { config } from '../config.js';
import { rateLimit, requireAuth } from '../auth.js';
import { HttpError, handle } from '../errors.js';
import * as v from '../lib/validate.js';
import { distanceKm } from '../lib/geo.js';
import {
  ageFromBirthdate, connect, disconnect, hasCrush, isBlockedEitherWay, isConnected, isOnline,
  loadVisibleProfile, notify, PROFILE_SELECT, publicProfile, viewerContext,
} from '../lib/social.js';

export const socialRouter = Router();
socialRouter.use(requireAuth);

const targetId = (req) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Unknown member.');
  return id;
};

/**
 * Discover feed. Candidates are filtered by privacy, blocks, prior decisions
 * and the viewer's preferences, then ranked by a light compatibility score.
 * Query params override saved preferences for this request only.
 */
socialRouter.get(
  '/discover',
  handle((req, res) => {
    const db = getDb();
    const me = req.user.id;
    const prefs = db.prepare('SELECT * FROM preferences WHERE user_id = ?').get(me);
    const viewer = viewerContext(me);
    const ageMin = prefs.age_min;
    const ageMax = prefs.age_max;
    const maxDistance = prefs.max_distance;
    const intentions = parseJson(prefs.intentions, []);
    const interests = parseJson(prefs.interests, []);
    const limit = Math.min(Number(req.query.limit) || 24, 50);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const rows = db
      .prepare(
        `${PROFILE_SELECT}
          WHERE p.user_id != ? AND p.onboarded = 1 AND u.status = 'active'
            AND pr.discoverable = 1 AND pr.incognito = 0 AND pr.profile_visibility = 'everyone'
            AND (? = 0 OR p.verification = 'verified')
            AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = p.user_id) OR (b.blocker_id = p.user_id AND b.blocked_id = ?))
            AND NOT EXISTS (SELECT 1 FROM crushes c WHERE c.from_id = ? AND c.to_id = p.user_id)
            AND NOT EXISTS (SELECT 1 FROM passes x WHERE x.from_id = ? AND x.to_id = p.user_id)
            AND NOT EXISTS (SELECT 1 FROM connections k WHERE (k.user_a = ? AND k.user_b = p.user_id) OR (k.user_b = ? AND k.user_a = p.user_id))`,
      )
      .all(me, prefs.verified_only, me, me, me, me, me, me);

    const scored = [];
    for (const row of rows) {
      const age = ageFromBirthdate(row.birthdate);
      if (age == null || age < ageMin || age > ageMax) continue;
      const km = distanceKm(viewer.lat, viewer.lng, row.lat, row.lng);
      if (maxDistance > 0 && km != null && km > maxDistance) continue;
      const theirIntentions = parseJson(row.intentions, []);
      const theirInterests = parseJson(row.interests, []);
      if (intentions.length && !theirIntentions.some((i) => intentions.includes(i))) continue;
      if (interests.length && !theirInterests.some((i) => interests.includes(i))) continue;
      const shared = theirInterests.filter((i) => viewer.interests.includes(i)).length;
      const sharedIntent = theirIntentions.filter((i) => viewer.intentions.includes(i)).length;
      let score = shared * 3 + sharedIntent * 2;
      if (row.verification === 'verified') score += 2;
      if (isOnline(row.last_active_at)) score += 3;
      if (km != null) score += Math.max(0, 4 - km / 10);
      if (hasCrush(row.user_id, me)) score += 1; // gently surface people already into you
      scored.push({ row, score });
    }
    scored.sort((a, b) => b.score - a.score || b.row.last_active_at - a.row.last_active_at);
    const page = scored.slice(offset, offset + limit).map(({ row }) => publicProfile(row, viewer));
    res.json({
      items: page,
      nextOffset: offset + limit < scored.length ? offset + limit : null,
      total: scored.length,
      viewerHasLocation: viewer.lat != null,
    });
  }),
);

socialRouter.get(
  '/users/:id',
  handle((req, res) => {
    const profile = loadVisibleProfile(req.user.id, targetId(req), { full: true });
    if (!profile) throw new HttpError(404, 'This profile isn’t available.');
    const db = getDb();
    const moments = db
      .prepare(
        `SELECT id, kind, body, media_url AS mediaUrl, style, created_at AS createdAt FROM moments
          WHERE user_id = ? AND expires_at > ? AND (audience = 'everyone' OR ?)
          ORDER BY id DESC LIMIT 6`,
      )
      .all(profile.id, now(), isConnected(req.user.id, profile.id) ? 1 : 0);
    res.json({ ...profile, moments });
  }),
);

/**
 * Crush (or Deep Crush). Returns `{ mutual: true }` when the feeling is mutual,
 * at which point a connection is created and both members are notified.
 */
socialRouter.post(
  '/users/:id/crush',
  handle((req, res) => {
    const me = req.user.id;
    const them = targetId(req);
    if (me === them) throw new HttpError(400, 'You can’t crush on yourself — though we admire the confidence.');
    const target = loadVisibleProfile(me, them);
    if (!target) throw new HttpError(404, 'This profile isn’t available.');
    const db = getDb();
    const theirPrivacy = db.prepare('SELECT who_can_crush FROM privacy WHERE user_id = ?').get(them);
    if (theirPrivacy.who_can_crush === 'verified') {
      const verified = db.prepare("SELECT 1 FROM profiles WHERE user_id = ? AND verification = 'verified'").get(me);
      if (!verified) throw new HttpError(403, `${target.name} only accepts Crushes from verified members.`, 'verification_required');
    }
    const deep = !!req.body?.deep;
    const note = req.body?.note ? v.str(req.body.note, 'Note', { max: 140 }) : null;
    const existing = hasCrush(me, them);
    if (deep && !existing?.deep) {
      const since = now() - 24 * 60 * 60 * 1000;
      const used = db.prepare('SELECT COUNT(*) AS n FROM crushes WHERE from_id = ? AND deep = 1 AND created_at > ?').get(me, since).n;
      if (used >= config.freeDeepCrushesPerDay) {
        throw new HttpError(429, `You’ve sent your ${config.freeDeepCrushesPerDay} Deep Crushes for today. They refresh tomorrow — a regular Crush still says plenty.`, 'deep_limit');
      }
    }
    const result = tx(() => {
      db.prepare(
        `INSERT INTO crushes (from_id, to_id, deep, note, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(from_id, to_id) DO UPDATE SET deep = MAX(deep, excluded.deep), note = COALESCE(excluded.note, note)`,
      ).run(me, them, deep ? 1 : 0, note, now());
      db.prepare('DELETE FROM passes WHERE from_id = ? AND to_id = ?').run(me, them);
      const reciprocal = hasCrush(them, me);
      const alreadyConnected = isConnected(me, them);
      if (reciprocal && !alreadyConnected) {
        connect(me, them);
        notify(them, 'mutual', { actorId: me });
        notify(me, 'mutual', { actorId: them });
        return { mutual: true, isNew: true };
      }
      if (!existing || (deep && !existing.deep)) {
        notify(them, deep ? 'deep_crush' : 'crush', { actorId: me, body: note || '' });
      }
      return { mutual: alreadyConnected, isNew: false };
    });
    res.json({ ...result, profile: loadVisibleProfile(me, them) });
  }),
);

socialRouter.delete(
  '/users/:id/crush',
  handle((req, res) => {
    const me = req.user.id;
    const them = targetId(req);
    if (isConnected(me, them)) {
      throw new HttpError(400, 'You’re already connected. Use “Remove connection” to end it.');
    }
    getDb().prepare('DELETE FROM crushes WHERE from_id = ? AND to_id = ?').run(me, them);
    res.json({ ok: true });
  }),
);

socialRouter.post(
  '/users/:id/pass',
  handle((req, res) => {
    const me = req.user.id;
    const them = targetId(req);
    getDb().prepare('INSERT OR REPLACE INTO passes (from_id, to_id, created_at) VALUES (?, ?, ?)').run(me, them, now());
    res.json({ ok: true });
  }),
);

socialRouter.delete(
  '/users/:id/pass',
  handle((req, res) => {
    getDb().prepare('DELETE FROM passes WHERE from_id = ? AND to_id = ?').run(req.user.id, targetId(req));
    res.json({ ok: true });
  }),
);

/** Remove connection (unmatch). Ends the Mutual Crush and closes the conversation for both. */
socialRouter.delete(
  '/connections/:id',
  handle((req, res) => {
    const me = req.user.id;
    const them = targetId(req);
    tx(() => {
      disconnect(me, them);
      getDb().prepare('INSERT OR REPLACE INTO passes (from_id, to_id, created_at) VALUES (?, ?, ?)').run(me, them, now());
    });
    res.json({ ok: true });
  }),
);

socialRouter.post(
  '/users/:id/block',
  handle((req, res) => {
    const me = req.user.id;
    const them = targetId(req);
    if (me === them) throw new HttpError(400, 'You can’t block yourself.');
    if (!getDb().prepare('SELECT 1 FROM users WHERE id = ?').get(them)) throw new HttpError(404, 'Member not found.');
    tx(() => {
      getDb().prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)').run(me, them, now());
      disconnect(me, them);
    });
    res.json({ ok: true });
  }),
);

socialRouter.delete(
  '/users/:id/block',
  handle((req, res) => {
    getDb().prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(req.user.id, targetId(req));
    res.json({ ok: true });
  }),
);

socialRouter.get(
  '/blocks',
  handle((req, res) => {
    const rows = getDb()
      .prepare(
        `SELECT b.blocked_id AS id, p.name, b.created_at AS blockedAt,
                (SELECT url FROM photos ph WHERE ph.user_id = b.blocked_id ORDER BY position LIMIT 1) AS photo
           FROM blocks b JOIN profiles p ON p.user_id = b.blocked_id
          WHERE b.blocker_id = ? ORDER BY b.created_at DESC`,
      )
      .all(req.user.id);
    res.json({ items: rows });
  }),
);

export const REPORT_REASONS = [
  'fake_profile', 'harassment', 'inappropriate_content', 'scam', 'underage', 'hate_speech', 'threats_safety', 'other',
];

const reportLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, message: 'You’ve sent a lot of reports. Our team is on it — try again later.' });

socialRouter.post(
  '/users/:id/report',
  reportLimiter,
  handle((req, res) => {
    const me = req.user.id;
    const them = targetId(req);
    if (me === them) throw new HttpError(400, 'You can’t report yourself.');
    if (!getDb().prepare('SELECT 1 FROM users WHERE id = ?').get(them)) throw new HttpError(404, 'Member not found.');
    const reason = v.oneOf(req.body?.reason, 'Reason', REPORT_REASONS);
    const details = v.str(req.body?.details, 'Details', { max: 1000 });
    const context = v.str(req.body?.context, 'Context', { max: 60 });
    tx(() => {
      getDb()
        .prepare('INSERT INTO reports (reporter_id, reported_id, reason, details, context, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(me, them, reason, details, context, now());
      if (req.body?.alsoBlock) {
        getDb().prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)').run(me, them, now());
        disconnect(me, them);
      }
    });
    res.status(201).json({ ok: true, blocked: !!req.body?.alsoBlock });
  }),
);

/** Crushes hub: who's crushing on you, your crushes, and Mutual Crushes. */
socialRouter.get(
  '/crushes',
  handle((req, res) => {
    const me = req.user.id;
    const db = getDb();
    const viewer = viewerContext(me);
    const load = (sql, ...args) =>
      db
        .prepare(sql)
        .all(...args)
        .filter((r) => !isBlockedEitherWay(me, r.user_id) && r.onboarded && r.status === 'active')
        .map((r) => ({ ...publicProfile(r, viewer), at: r.at }));

    const incoming = load(
      `${PROFILE_SELECT} JOIN crushes c ON c.from_id = p.user_id AND c.to_id = ?
        WHERE NOT EXISTS (SELECT 1 FROM connections k WHERE (k.user_a = ? AND k.user_b = p.user_id) OR (k.user_b = ? AND k.user_a = p.user_id))
          AND NOT EXISTS (SELECT 1 FROM passes x WHERE x.from_id = ? AND x.to_id = p.user_id)
        ORDER BY c.deep DESC, c.created_at DESC`.replace('SELECT p.*', 'SELECT c.created_at AS at, p.*'),
      me, me, me, me,
    );
    const outgoing = load(
      `${PROFILE_SELECT} JOIN crushes c ON c.to_id = p.user_id AND c.from_id = ?
        WHERE NOT EXISTS (SELECT 1 FROM connections k WHERE (k.user_a = ? AND k.user_b = p.user_id) OR (k.user_b = ? AND k.user_a = p.user_id))
        ORDER BY c.created_at DESC`.replace('SELECT p.*', 'SELECT c.created_at AS at, p.*'),
      me, me, me,
    );
    const mutual = load(
      `${PROFILE_SELECT} JOIN connections k ON (k.user_a = ? AND k.user_b = p.user_id) OR (k.user_b = ? AND k.user_a = p.user_id)
        ORDER BY k.created_at DESC`.replace('SELECT p.*', 'SELECT k.created_at AS at, p.*'),
      me, me,
    );
    res.json({ incoming, outgoing, mutual });
  }),
);
