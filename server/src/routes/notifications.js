import { Router } from 'express';
import { getDb, now } from '../db.js';
import { requireAuth } from '../auth.js';
import { handle } from '../errors.js';
import { isBlockedEitherWay, photosFor } from '../lib/social.js';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get(
  '/notifications',
  handle((req, res) => {
    const me = req.user.id;
    const rows = getDb()
      .prepare(
        `SELECT n.*, p.name AS actor_name, p.verification AS actor_verification FROM notifications n
           LEFT JOIN profiles p ON p.user_id = n.actor_id
          WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT 100`,
      )
      .all(me);
    const items = rows
      .filter((n) => !n.actor_id || !isBlockedEitherWay(me, n.actor_id))
      .map((n) => ({
        id: n.id,
        kind: n.kind,
        body: n.body,
        refId: n.ref_id,
        createdAt: n.created_at,
        read: !!n.read_at,
        actor: n.actor_id
          ? { id: n.actor_id, name: n.actor_name, verified: n.actor_verification === 'verified', photo: photosFor(n.actor_id)[0]?.url || null }
          : null,
      }));
    res.json({ items });
  }),
);

notificationsRouter.post(
  '/notifications/read',
  handle((req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : null;
    const db = getDb();
    if (ids && ids.length) {
      const stmt = db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND id = ? AND read_at IS NULL');
      ids.forEach((id) => stmt.run(now(), req.user.id, id));
    } else if (req.body?.kinds && Array.isArray(req.body.kinds)) {
      const stmt = db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND kind = ? AND read_at IS NULL');
      req.body.kinds.forEach((k) => stmt.run(now(), req.user.id, String(k)));
    } else {
      db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now(), req.user.id);
    }
    res.json({ ok: true });
  }),
);
