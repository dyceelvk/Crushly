import { getDb, now, parseJson } from '../db.js';
import { config } from '../config.js';
import { distanceKm, distanceLabel } from './geo.js';

const pair = (a, b) => (a < b ? [a, b] : [b, a]);

export function ageFromBirthdate(birthdate) {
  if (!birthdate) return null;
  const [y, m, d] = birthdate.split('-').map(Number);
  if (!y || !m || !d) return null;
  const today = new Date();
  let age = today.getUTCFullYear() - y;
  const beforeBirthday =
    today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

export function isBlockedEitherWay(a, b) {
  return !!getDb()
    .prepare(
      'SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)',
    )
    .get(a, b, b, a);
}

export function hasCrush(from, to) {
  return getDb().prepare('SELECT deep, note, created_at FROM crushes WHERE from_id = ? AND to_id = ?').get(from, to) || null;
}

export function isConnected(a, b) {
  const [x, y] = pair(a, b);
  return !!getDb().prepare('SELECT 1 FROM connections WHERE user_a = ? AND user_b = ?').get(x, y);
}

export function connect(a, b) {
  const [x, y] = pair(a, b);
  getDb().prepare('INSERT OR IGNORE INTO connections (user_a, user_b, created_at) VALUES (?, ?, ?)').run(x, y, now());
}

/** Removes the connection and both crushes, and closes any conversation. Used by unmatch and block. */
export function disconnect(a, b) {
  const db = getDb();
  const [x, y] = pair(a, b);
  db.prepare('DELETE FROM connections WHERE user_a = ? AND user_b = ?').run(x, y);
  db.prepare('DELETE FROM crushes WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)').run(a, b, b, a);
  db.prepare('UPDATE conversations SET closed = 1 WHERE user_a = ? AND user_b = ?').run(x, y);
}

export function findConversation(a, b) {
  const [x, y] = pair(a, b);
  return getDb().prepare('SELECT * FROM conversations WHERE user_a = ? AND user_b = ?').get(x, y) || null;
}

export function ensureConversation(a, b) {
  const db = getDb();
  const [x, y] = pair(a, b);
  const existing = findConversation(a, b);
  if (existing) {
    if (existing.closed) db.prepare('UPDATE conversations SET closed = 0 WHERE id = ?').run(existing.id);
    return { ...existing, closed: 0 };
  }
  const info = db
    .prepare('INSERT INTO conversations (user_a, user_b, created_at) VALUES (?, ?, ?)')
    .run(x, y, now());
  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(info.lastInsertRowid);
}

export function getPrivacy(userId) {
  return getDb().prepare('SELECT * FROM privacy WHERE user_id = ?').get(userId);
}

/**
 * Can `viewer` start/continue a conversation with `target`?
 * Returns null when allowed or a human explanation when not.
 */
export function messagingBlockReason(viewerId, targetId) {
  if (viewerId === targetId) return "You can't message yourself.";
  if (isBlockedEitherWay(viewerId, targetId)) return 'This member is no longer available.';
  if (isConnected(viewerId, targetId)) return null;
  const target = getPrivacy(targetId);
  const name = getDb().prepare('SELECT name FROM profiles WHERE user_id = ?').get(targetId)?.name || 'This member';
  const rule = target?.who_can_message || 'mutual';
  if (rule === 'everyone') return null;
  if (rule === 'crushes' && hasCrush(targetId, viewerId)) return null;
  if (rule === 'crushes') return `${name} only hears from people they've crushed on. Send a Crush and see if it's mutual.`;
  return `${name} only receives messages from Mutual Crushes. Send a Crush first.`;
}

export function isOnline(lastActiveAt) {
  return now() - lastActiveAt < config.onlineWindowMs;
}

function activityLabel(lastActiveAt) {
  const diff = now() - lastActiveAt;
  if (diff < config.onlineWindowMs) return 'Online now';
  if (diff < 60 * 60 * 1000) return 'Active recently';
  if (diff < 24 * 60 * 60 * 1000) return 'Active today';
  if (diff < 7 * 24 * 60 * 60 * 1000) return 'Active this week';
  return null;
}

export function photosFor(userId) {
  return getDb()
    .prepare('SELECT id, url FROM photos WHERE user_id = ? ORDER BY position, id')
    .all(userId);
}

export function viewerContext(viewerId) {
  const db = getDb();
  const me = db
    .prepare(
      `SELECT p.lat, p.lng, p.interests, p.intentions, p.verification, pr.show_online, pr.read_receipts
         FROM profiles p JOIN privacy pr ON pr.user_id = p.user_id WHERE p.user_id = ?`,
    )
    .get(viewerId);
  return {
    id: viewerId,
    lat: me?.lat ?? null,
    lng: me?.lng ?? null,
    interests: parseJson(me?.interests, []),
    intentions: parseJson(me?.intentions, []),
    showOnline: !!me?.show_online,
    verified: me?.verification === 'verified',
  };
}

/**
 * Serializes a member for another member, applying every privacy rule.
 * `row` must include profile, privacy and user columns (see PROFILE_SELECT).
 */
export function publicProfile(row, viewer, { full = false } = {}) {
  const interests = parseJson(row.interests, []);
  const intentions = parseJson(row.intentions, []);
  const km = distanceKm(viewer.lat, viewer.lng, row.lat, row.lng);
  const connected = isConnected(viewer.id, row.user_id);
  const myCrush = hasCrush(viewer.id, row.user_id);
  const theirCrush = hasCrush(row.user_id, viewer.id);
  // Online status is reciprocal: hide yours and you won't see others'.
  const canSeeActivity = !!row.show_online && viewer.showOnline;

  const profile = {
    id: row.user_id,
    name: row.name,
    age: row.show_age ? ageFromBirthdate(row.birthdate) : null,
    pronouns: row.pronouns || null,
    city: row.show_city ? row.city || null : null,
    verified: row.verification === 'verified',
    distance: row.show_distance ? distanceLabel(km) : null,
    online: canSeeActivity ? isOnline(row.last_active_at) : null,
    activity: canSeeActivity ? activityLabel(row.last_active_at) : null,
    bio: row.bio,
    intentions,
    relationshipIntention: row.relationship_intention || null,
    interests,
    sharedInterests: interests.filter((i) => viewer.interests.includes(i)),
    photos: photosFor(row.user_id),
    crush: {
      sent: !!myCrush,
      sentDeep: !!myCrush?.deep,
      received: !!theirCrush,
      receivedDeep: !!theirCrush?.deep,
      note: theirCrush?.note || null,
      mutual: connected,
    },
    canMessage: messagingBlockReason(viewer.id, row.user_id) === null,
    acceptsCrushes: row.who_can_crush !== 'verified' || viewer.verified,
  };
  if (full) {
    profile.languages = parseJson(row.languages, []);
    profile.lifestyle = parseJson(row.lifestyle, {});
    profile.messageBlockReason = messagingBlockReason(viewer.id, row.user_id);
  }
  return profile;
}

export const PROFILE_SELECT = `
  SELECT p.*, u.last_active_at, u.status, pr.show_distance, pr.show_online, pr.discoverable,
         pr.profile_visibility, pr.who_can_message, pr.who_can_crush, pr.show_age, pr.show_city
    FROM profiles p
    JOIN users u ON u.id = p.user_id
    JOIN privacy pr ON pr.user_id = p.user_id
`;

/** Loads a member as seen by `viewerId`, or null if hidden/blocked/unavailable. */
export function loadVisibleProfile(viewerId, targetId, opts) {
  if (viewerId !== targetId && isBlockedEitherWay(viewerId, targetId)) return null;
  const row = getDb().prepare(`${PROFILE_SELECT} WHERE p.user_id = ?`).get(targetId);
  if (!row || !row.onboarded) return null;
  if (viewerId !== targetId) {
    if (row.status !== 'active' && !isConnected(viewerId, targetId)) return null;
    if (row.profile_visibility === 'connections' && !isConnected(viewerId, targetId) && !hasCrush(targetId, viewerId)) {
      return null;
    }
  }
  return publicProfile(row, viewerContext(viewerId), opts);
}

export function isVerified(userId) {
  return getDb().prepare("SELECT 1 FROM profiles WHERE user_id = ? AND verification = 'verified'").get(userId) != null;
}

export function notificationAllowed(userId, kind) {
  const s = getDb().prepare('SELECT * FROM notification_settings WHERE user_id = ?').get(userId);
  if (!s) return true;
  if (kind === 'message') return !!s.messages;
  if (kind === 'crush' || kind === 'deep_crush' || kind === 'mutual') return !!s.crushes;
  if (kind === 'moment_reply' || kind === 'moment_reaction') return !!s.moments;
  return true;
}

export function notify(userId, kind, { actorId = null, refId = null, body = '' } = {}) {
  if (!notificationAllowed(userId, kind)) return;
  const db = getDb();
  if (kind === 'message' && actorId) {
    // Collapse unread message notifications per sender so the center stays calm.
    const existing = db
      .prepare("SELECT id FROM notifications WHERE user_id = ? AND kind = 'message' AND actor_id = ? AND read_at IS NULL")
      .get(userId, actorId);
    if (existing) {
      db.prepare('UPDATE notifications SET created_at = ?, body = ?, ref_id = ? WHERE id = ?').run(now(), body, refId, existing.id);
      return;
    }
  }
  db.prepare(
    'INSERT INTO notifications (user_id, kind, actor_id, ref_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(userId, kind, actorId, refId, body, now());
}
