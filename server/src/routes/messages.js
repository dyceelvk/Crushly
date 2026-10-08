import { Router } from 'express';
import { getDb, now, parseJson } from '../db.js';
import { requireAuth } from '../auth.js';
import { HttpError, handle } from '../errors.js';
import * as v from '../lib/validate.js';
import {
  ensureConversation, isBlockedEitherWay, isOnline, loadVisibleProfile, messagingBlockReason, notify, photosFor,
} from '../lib/social.js';
import { mediaUpload, publicUrlFor, removeUploadedFile } from '../uploads.js';

export const messagesRouter = Router();
messagesRouter.use(requireAuth);

const otherId = (conv, me) => (conv.user_a === me ? conv.user_b : conv.user_a);

function loadConversation(id, me) {
  const conv = getDb().prepare('SELECT * FROM conversations WHERE id = ?').get(Number(id));
  if (!conv || (conv.user_a !== me && conv.user_b !== me)) throw new HttpError(404, 'Conversation not found.');
  return conv;
}

/** Read receipts are reciprocal: both members must have them on. */
function receiptsVisible(a, b) {
  const rows = getDb().prepare('SELECT read_receipts FROM privacy WHERE user_id IN (?, ?)').all(a, b);
  return rows.length === 2 && rows.every((r) => r.read_receipts);
}

function serializeMessage(m, me, showReceipts) {
  const reactions = getDb().prepare('SELECT user_id AS userId, kind FROM message_reactions WHERE message_id = ?').all(m.id);
  return {
    id: m.id,
    conversationId: m.conversation_id,
    senderId: m.sender_id,
    mine: m.sender_id === me,
    kind: m.kind,
    body: m.body,
    mediaUrl: m.media_url,
    meta: parseJson(m.meta, {}),
    createdAt: m.created_at,
    readAt: m.sender_id === me && !showReceipts ? null : m.read_at,
    reactions,
  };
}

function peerSummary(peerId, me) {
  const db = getDb();
  const p = db
    .prepare(
      `SELECT p.name, p.verification, u.last_active_at, pr.show_online FROM profiles p
         JOIN users u ON u.id = p.user_id JOIN privacy pr ON pr.user_id = p.user_id WHERE p.user_id = ?`,
    )
    .get(peerId);
  const mine = db.prepare('SELECT show_online FROM privacy WHERE user_id = ?').get(me);
  return {
    id: peerId,
    name: p?.name || 'Member',
    verified: p?.verification === 'verified',
    photo: photosFor(peerId)[0]?.url || null,
    online: p && p.show_online && mine?.show_online ? isOnline(p.last_active_at) : null,
  };
}

messagesRouter.get(
  '/conversations',
  handle((req, res) => {
    const me = req.user.id;
    const db = getDb();
    const convs = db
      .prepare(
        `SELECT c.* FROM conversations c
          WHERE (c.user_a = ? OR c.user_b = ?) AND c.closed = 0
          ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`,
      )
      .all(me, me);
    const items = convs
      .filter((c) => !isBlockedEitherWay(me, otherId(c, me)))
      .map((c) => {
        const last = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1').get(c.id);
        const unread = db
          .prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND sender_id != ? AND read_at IS NULL')
          .get(c.id, me).n;
        return {
          id: c.id,
          peer: peerSummary(otherId(c, me), me),
          lastMessage: last ? serializeMessage(last, me, false) : null,
          unread,
          updatedAt: c.last_message_at || c.created_at,
        };
      });
    res.json({ items });
  }),
);

/** Opens (or reopens) a conversation with a member, if their privacy settings allow it. */
messagesRouter.post(
  '/conversations',
  handle((req, res) => {
    const me = req.user.id;
    const them = Number(req.body?.userId);
    if (!Number.isInteger(them)) throw new HttpError(400, 'Who would you like to message?');
    const reason = messagingBlockReason(me, them);
    if (reason) throw new HttpError(403, reason, 'messaging_restricted');
    if (!loadVisibleProfile(me, them)) throw new HttpError(404, 'This profile isn’t available.');
    const conv = ensureConversation(me, them);
    res.json({ id: conv.id, peer: peerSummary(them, me) });
  }),
);

messagesRouter.get(
  '/conversations/:id',
  handle((req, res) => {
    const me = req.user.id;
    const conv = loadConversation(req.params.id, me);
    const peer = otherId(conv, me);
    if (isBlockedEitherWay(me, peer)) throw new HttpError(404, 'Conversation not found.');
    res.json({
      id: conv.id,
      closed: !!conv.closed,
      peer: peerSummary(peer, me),
      canSend: !conv.closed && messagingBlockReason(me, peer) === null,
      blockReason: conv.closed ? 'This connection has ended.' : messagingBlockReason(me, peer),
    });
  }),
);

/** Paged history. `after` fetches newer messages (polling); `before` pages back. */
messagesRouter.get(
  '/conversations/:id/messages',
  handle((req, res) => {
    const me = req.user.id;
    const conv = loadConversation(req.params.id, me);
    const peer = otherId(conv, me);
    if (isBlockedEitherWay(me, peer)) throw new HttpError(404, 'Conversation not found.');
    const db = getDb();
    const after = Number(req.query.after) || 0;
    const before = Number(req.query.before) || 0;
    const limit = Math.min(Number(req.query.limit) || 40, 100);
    let rows;
    if (after) {
      rows = db.prepare('SELECT * FROM messages WHERE conversation_id = ? AND id > ? ORDER BY id ASC LIMIT ?').all(conv.id, after, limit);
    } else if (before) {
      rows = db.prepare('SELECT * FROM messages WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT ?').all(conv.id, before, limit).reverse();
    } else {
      rows = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?').all(conv.id, limit).reverse();
    }
    const showReceipts = receiptsVisible(me, peer);
    // Read state of my latest messages, so the client can refresh "Seen" without refetching history.
    const lastReadMine = showReceipts
      ? db.prepare('SELECT MAX(id) AS id FROM messages WHERE conversation_id = ? AND sender_id = ? AND read_at IS NOT NULL').get(conv.id, me).id
      : null;
    res.json({
      items: rows.map((m) => serializeMessage(m, me, showReceipts)),
      hasMore: !after && rows.length === limit,
      lastReadMine,
    });
  }),
);

const STICKERS = ['wave', 'blush', 'fire', 'cheers', 'wink', 'heart_eyes', 'coffee', 'crown'];

messagesRouter.post(
  '/conversations/:id/messages',
  mediaUpload.single('media'),
  handle((req, res) => {
    const me = req.user.id;
    const conv = loadConversation(req.params.id, me);
    const peer = otherId(conv, me);
    const cleanup = () => req.file && removeUploadedFile(publicUrlFor(req.file));
    if (conv.closed) {
      cleanup();
      throw new HttpError(403, 'This connection has ended.');
    }
    const reason = messagingBlockReason(me, peer);
    if (reason) {
      cleanup();
      throw new HttpError(403, reason, 'messaging_restricted');
    }
    const kind = req.body?.kind || 'text';
    let body = '';
    let mediaUrl = null;
    let meta = {};
    try {
      switch (kind) {
        case 'text':
          body = v.str(req.body.body, 'Message', { required: true, max: 2000 });
          break;
        case 'photo':
          if (!req.file || !req.file.mimetype.startsWith('image/')) throw new HttpError(400, 'Choose a photo to send.');
          mediaUrl = publicUrlFor(req.file);
          body = v.str(req.body.body, 'Caption', { max: 300 });
          break;
        case 'voice': {
          if (!req.file || req.file.mimetype.startsWith('image/')) throw new HttpError(400, 'Record a voice message to send.');
          mediaUrl = publicUrlFor(req.file);
          const duration = Math.round(Number(req.body.duration) || 0);
          meta = { duration: Math.min(Math.max(duration, 1), 300) };
          break;
        }
        case 'sticker':
          meta = { sticker: v.oneOf(req.body.sticker, 'Sticker', STICKERS) };
          break;
        case 'profile': {
          const sharedId = Number(req.body.profileId);
          const shared = loadVisibleProfile(me, sharedId);
          if (!shared) throw new HttpError(404, 'That profile can’t be shared.');
          meta = { profileId: shared.id, name: shared.name, age: shared.age, photo: shared.photos[0]?.url || null, verified: shared.verified };
          break;
        }
        default:
          throw new HttpError(400, 'Unsupported message type.');
      }
    } catch (err) {
      cleanup();
      throw err;
    }
    const db = getDb();
    const t = now();
    const info = db
      .prepare('INSERT INTO messages (conversation_id, sender_id, kind, body, media_url, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(conv.id, me, kind, body, mediaUrl, JSON.stringify(meta), t);
    db.prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?').run(t, conv.id);
    const preview = kind === 'text' ? body.slice(0, 80) : { photo: 'Sent a photo', voice: 'Sent a voice message', sticker: 'Sent a sticker', profile: 'Shared a profile' }[kind];
    notify(peer, 'message', { actorId: me, refId: conv.id, body: preview });
    const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(serializeMessage(row, me, receiptsVisible(me, peer)));
  }),
);

messagesRouter.post(
  '/conversations/:id/read',
  handle((req, res) => {
    const me = req.user.id;
    const conv = loadConversation(req.params.id, me);
    const db = getDb();
    db.prepare('UPDATE messages SET read_at = ? WHERE conversation_id = ? AND sender_id != ? AND read_at IS NULL').run(now(), conv.id, me);
    db.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND kind = 'message' AND ref_id = ? AND read_at IS NULL").run(now(), me, conv.id);
    res.json({ ok: true });
  }),
);

/** Crush reaction on a message (toggle). */
messagesRouter.post(
  '/messages/:id/react',
  handle((req, res) => {
    const me = req.user.id;
    const db = getDb();
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(req.params.id));
    if (!msg) throw new HttpError(404, 'Message not found.');
    loadConversation(msg.conversation_id, me);
    const kind = v.oneOf(req.body?.kind || 'crush', 'Reaction', ['crush', 'laugh', 'fire', 'wow']);
    const existing = db.prepare('SELECT kind FROM message_reactions WHERE message_id = ? AND user_id = ?').get(msg.id, me);
    if (existing && existing.kind === kind) {
      db.prepare('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ?').run(msg.id, me);
    } else {
      db.prepare('INSERT OR REPLACE INTO message_reactions (message_id, user_id, kind, created_at) VALUES (?, ?, ?, ?)').run(msg.id, me, kind, now());
    }
    const conv = loadConversation(msg.conversation_id, me);
    res.json(serializeMessage(msg, me, receiptsVisible(me, otherId(conv, me))));
  }),
);
