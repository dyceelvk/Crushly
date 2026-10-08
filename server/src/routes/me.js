import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { getDb, now, parseJson, tx } from '../db.js';
import { config } from '../config.js';
import { destroyAllSessions, hashPassword, requireAuth, verifyPassword } from '../auth.js';
import { HttpError, handle } from '../errors.js';
import * as v from '../lib/validate.js';
import { snapCoordinate } from '../lib/geo.js';
import { ageFromBirthdate, photosFor } from '../lib/social.js';
import { imageUpload, privateUpload, publicUrlFor, removeUploadedFile } from '../uploads.js';

export const meRouter = Router();
meRouter.use(requireAuth);

const VERIFICATION_POSES = [
  'Hold up a peace sign next to your face',
  'Touch your chin with your thumb',
  'Give a thumbs up beside your cheek',
  'Point at the camera with one finger',
];

function completion(profile, photos) {
  const interests = parseJson(profile.interests, []);
  const languages = parseJson(profile.languages, []);
  const lifestyle = parseJson(profile.lifestyle, {});
  const checks = [
    { label: 'Add a photo', weight: 20, done: photos.length >= 1 },
    { label: 'Add at least 3 photos', weight: 10, done: photos.length >= 3 },
    { label: 'Name and birthday', weight: 10, done: !!profile.name && !!profile.birthdate },
    { label: 'Write a bio', weight: 15, done: profile.bio.length >= 20 },
    { label: 'Pick 3 interests', weight: 10, done: interests.length >= 3 },
    { label: 'Say what you’re looking for', weight: 10, done: parseJson(profile.intentions, []).length > 0 },
    { label: 'Relationship intention', weight: 5, done: !!profile.relationship_intention },
    { label: 'Pronouns', weight: 5, done: !!profile.pronouns },
    { label: 'Languages', weight: 5, done: languages.length > 0 },
    { label: 'Lifestyle details', weight: 5, done: Object.keys(lifestyle).length >= 2 },
    { label: 'Your city', weight: 5, done: !!profile.city },
  ];
  const percent = checks.reduce((sum, c) => sum + (c.done ? c.weight : 0), 0);
  return { percent, missing: checks.filter((c) => !c.done).map((c) => c.label) };
}

function deepCrushesLeft(userId) {
  const since = now() - 24 * 60 * 60 * 1000;
  const used = getDb()
    .prepare('SELECT COUNT(*) AS n FROM crushes WHERE from_id = ? AND deep = 1 AND created_at > ?')
    .get(userId, since).n;
  return Math.max(0, config.freeDeepCrushesPerDay - used);
}

/** Full, private view of the signed-in member. Only ever returned to the member themself. */
export function serializeMe(userId) {
  const db = getDb();
  const user = db.prepare('SELECT id, email, status, plus_interest, created_at FROM users WHERE id = ?').get(userId);
  const p = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId);
  const prefs = db.prepare('SELECT * FROM preferences WHERE user_id = ?').get(userId);
  const privacy = db.prepare('SELECT * FROM privacy WHERE user_id = ?').get(userId);
  const notif = db.prepare('SELECT * FROM notification_settings WHERE user_id = ?').get(userId);
  const photos = photosFor(userId);
  const pendingPose = db
    .prepare("SELECT pose FROM verification_requests WHERE user_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1")
    .get(userId)?.pose;
  return {
    id: user.id,
    email: user.email,
    status: user.status,
    createdAt: user.created_at,
    onboarded: !!p.onboarded,
    profile: {
      name: p.name,
      birthdate: p.birthdate,
      age: ageFromBirthdate(p.birthdate),
      pronouns: p.pronouns,
      bio: p.bio,
      city: p.city,
      hasLocation: p.lat != null,
      intentions: parseJson(p.intentions, []),
      interests: parseJson(p.interests, []),
      languages: parseJson(p.languages, []),
      relationshipIntention: p.relationship_intention,
      lifestyle: parseJson(p.lifestyle, {}),
      photos,
    },
    verification: { status: p.verification, pose: pendingPose || null },
    completion: completion(p, photos),
    preferences: {
      ageMin: prefs.age_min,
      ageMax: prefs.age_max,
      maxDistance: prefs.max_distance,
      intentions: parseJson(prefs.intentions, []),
      interests: parseJson(prefs.interests, []),
      verifiedOnly: !!prefs.verified_only,
    },
    privacy: {
      showDistance: !!privacy.show_distance,
      showOnline: !!privacy.show_online,
      readReceipts: !!privacy.read_receipts,
      discoverable: !!privacy.discoverable,
      profileVisibility: privacy.profile_visibility,
      whoCanMessage: privacy.who_can_message,
      whoCanCrush: privacy.who_can_crush,
      showAge: !!privacy.show_age,
      showCity: !!privacy.show_city,
      incognito: !!privacy.incognito,
    },
    notifications: {
      messages: !!notif.messages,
      crushes: !!notif.crushes,
      moments: !!notif.moments,
      recommendations: !!notif.recommendations,
    },
    // Crushly Plus isn't for sale yet — entitlements are wired so features can light up later.
    plus: { active: false, interested: !!user.plus_interest, deepCrushesLeft: deepCrushesLeft(userId), deepCrushesPerDay: config.freeDeepCrushesPerDay },
  };
}

meRouter.get('/', handle((req, res) => res.json(serializeMe(req.user.id))));

/** Partial profile update. Fields omitted from the body are left untouched. */
meRouter.patch(
  '/profile',
  handle((req, res) => {
    const b = req.body || {};
    const db = getDb();
    const current = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(req.user.id);
    const next = { ...current };
    if ('name' in b) next.name = v.str(b.name, 'Name', { required: true, max: 30 });
    if ('birthdate' in b) {
      next.birthdate = v.birthdate(b.birthdate);
      const age = ageFromBirthdate(next.birthdate);
      if (age < 18) throw new HttpError(400, 'Crushly is for adults. You need to be 18 or older to join.');
      if (age > 99) throw new HttpError(400, 'Please check your birthday.');
    }
    if ('pronouns' in b) next.pronouns = v.str(b.pronouns, 'Pronouns', { max: 24 });
    if ('bio' in b) next.bio = v.str(b.bio, 'Bio', { max: 500 });
    if ('city' in b) next.city = v.str(b.city, 'City', { max: 60 });
    if ('intentions' in b) next.intentions = JSON.stringify(v.list(b.intentions, 'Intentions', v.INTENTIONS, { max: 6 }));
    if ('interests' in b) next.interests = JSON.stringify(v.list(b.interests, 'Interests', v.INTERESTS, { max: 10 }));
    if ('languages' in b) next.languages = JSON.stringify(v.list(b.languages, 'Languages', v.LANGUAGES, { max: 6 }));
    if ('relationshipIntention' in b) {
      next.relationship_intention = b.relationshipIntention
        ? v.oneOf(b.relationshipIntention, 'Relationship intention', v.RELATIONSHIP_INTENTIONS)
        : '';
    }
    if ('lifestyle' in b) next.lifestyle = JSON.stringify(v.lifestyle(b.lifestyle));
    if ('location' in b) {
      if (b.location === null) {
        next.lat = null;
        next.lng = null;
      } else {
        const lat = snapCoordinate(b.location?.lat);
        const lng = snapCoordinate(b.location?.lng);
        if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
          throw new HttpError(400, 'We couldn’t read that location.');
        }
        next.lat = lat;
        next.lng = lng;
      }
    }
    db.prepare(
      `UPDATE profiles SET name = ?, birthdate = ?, pronouns = ?, bio = ?, city = ?, lat = ?, lng = ?,
         intentions = ?, interests = ?, languages = ?, relationship_intention = ?, lifestyle = ?, updated_at = ?
       WHERE user_id = ?`,
    ).run(
      next.name, next.birthdate, next.pronouns, next.bio, next.city, next.lat, next.lng,
      next.intentions, next.interests, next.languages, next.relationship_intention, next.lifestyle, now(),
      req.user.id,
    );
    res.json(serializeMe(req.user.id));
  }),
);

/** Marks onboarding complete once the essentials exist. */
meRouter.post(
  '/onboarding/complete',
  handle((req, res) => {
    const db = getDb();
    const p = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(req.user.id);
    const missing = [];
    if (!p.name) missing.push('your name');
    if (!p.birthdate) missing.push('your birthday');
    if (photosFor(req.user.id).length === 0) missing.push('at least one photo');
    if (missing.length) throw new HttpError(400, `Almost there — add ${missing.join(', ')} to continue.`);
    db.prepare('UPDATE profiles SET onboarded = 1 WHERE user_id = ?').run(req.user.id);
    res.json(serializeMe(req.user.id));
  }),
);

meRouter.post(
  '/photos',
  imageUpload.single('photo'),
  handle((req, res) => {
    if (!req.file) throw new HttpError(400, 'Choose a photo to upload.');
    const db = getDb();
    const count = db.prepare('SELECT COUNT(*) AS n FROM photos WHERE user_id = ?').get(req.user.id).n;
    if (count >= config.maxPhotos) {
      removeUploadedFile(publicUrlFor(req.file));
      throw new HttpError(400, `You can show up to ${config.maxPhotos} photos.`);
    }
    db.prepare('INSERT INTO photos (user_id, url, position, created_at) VALUES (?, ?, ?, ?)').run(
      req.user.id, publicUrlFor(req.file), count, now(),
    );
    res.status(201).json(serializeMe(req.user.id));
  }),
);

meRouter.delete(
  '/photos/:id',
  handle((req, res) => {
    const db = getDb();
    const photo = db.prepare('SELECT * FROM photos WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
    if (!photo) throw new HttpError(404, 'Photo not found.');
    const p = db.prepare('SELECT onboarded FROM profiles WHERE user_id = ?').get(req.user.id);
    const count = db.prepare('SELECT COUNT(*) AS n FROM photos WHERE user_id = ?').get(req.user.id).n;
    if (p.onboarded && count <= 1) throw new HttpError(400, 'Keep at least one photo on your profile.');
    db.prepare('DELETE FROM photos WHERE id = ?').run(photo.id);
    removeUploadedFile(photo.url);
    res.json(serializeMe(req.user.id));
  }),
);

meRouter.put(
  '/photos/order',
  handle((req, res) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids)) throw new HttpError(400, 'Send the photo ids in order.');
    const db = getDb();
    const owned = new Set(db.prepare('SELECT id FROM photos WHERE user_id = ?').all(req.user.id).map((r) => r.id));
    tx(() => {
      ids.map(Number).filter((id) => owned.has(id)).forEach((id, i) => {
        db.prepare('UPDATE photos SET position = ? WHERE id = ?').run(i, id);
      });
    });
    res.json(serializeMe(req.user.id));
  }),
);

meRouter.put(
  '/preferences',
  handle((req, res) => {
    const b = req.body || {};
    const ageMin = v.int(b.ageMin ?? 18, 'Minimum age', { min: 18, max: 99 });
    const ageMax = v.int(b.ageMax ?? 45, 'Maximum age', { min: 18, max: 99 });
    if (ageMin > ageMax) throw new HttpError(400, 'The minimum age must be below the maximum.');
    const maxDistance = v.int(b.maxDistance ?? 50, 'Distance', { min: 0, max: 500 });
    getDb()
      .prepare(
        `UPDATE preferences SET age_min = ?, age_max = ?, max_distance = ?, intentions = ?, interests = ?, verified_only = ?
          WHERE user_id = ?`,
      )
      .run(
        ageMin, ageMax, maxDistance,
        JSON.stringify(v.list(b.intentions, 'Intentions', v.INTENTIONS, { max: 6 })),
        JSON.stringify(v.list(b.interests, 'Interests', v.INTERESTS, { max: 24 })),
        v.bool(b.verifiedOnly),
        req.user.id,
      );
    res.json(serializeMe(req.user.id));
  }),
);

const PRIVACY_FIELDS = {
  showDistance: ['show_distance', 'bool'],
  showOnline: ['show_online', 'bool'],
  readReceipts: ['read_receipts', 'bool'],
  discoverable: ['discoverable', 'bool'],
  showAge: ['show_age', 'bool'],
  showCity: ['show_city', 'bool'],
  profileVisibility: ['profile_visibility', ['everyone', 'connections']],
  whoCanMessage: ['who_can_message', ['everyone', 'crushes', 'mutual']],
  whoCanCrush: ['who_can_crush', ['everyone', 'verified']],
};

meRouter.patch(
  '/privacy',
  handle((req, res) => {
    const b = req.body || {};
    if (b.incognito) {
      throw new HttpError(402, 'Incognito is part of Crushly Plus, which isn’t available yet. Hide your profile from Discover instead — it’s free.', 'plus_required');
    }
    const db = getDb();
    for (const [key, [column, kind]] of Object.entries(PRIVACY_FIELDS)) {
      if (!(key in b)) continue;
      const value = kind === 'bool' ? v.bool(b[key]) : v.oneOf(b[key], key, kind);
      db.prepare(`UPDATE privacy SET ${column} = ? WHERE user_id = ?`).run(value, req.user.id);
    }
    res.json(serializeMe(req.user.id));
  }),
);

meRouter.patch(
  '/notification-settings',
  handle((req, res) => {
    const b = req.body || {};
    const db = getDb();
    for (const key of ['messages', 'crushes', 'moments', 'recommendations']) {
      if (key in b) db.prepare(`UPDATE notification_settings SET ${key} = ? WHERE user_id = ?`).run(v.bool(b[key]), req.user.id);
    }
    res.json(serializeMe(req.user.id));
  }),
);

meRouter.patch(
  '/account',
  handle((req, res) => {
    const b = req.body || {};
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(String(b.currentPassword || ''), user.password_hash)) {
      throw new HttpError(403, 'Your current password isn’t right.');
    }
    if (b.email) {
      const email = v.email(b.email);
      const taken = db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(email, user.id);
      if (taken) throw new HttpError(409, 'That email is already in use.');
      db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, user.id);
    }
    if (b.newPassword) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(v.password(b.newPassword)), user.id);
      destroyAllSessions(user.id, req.token); // sign out every other device
    }
    res.json(serializeMe(req.user.id));
  }),
);

meRouter.post(
  '/sessions/revoke-others',
  handle((req, res) => {
    destroyAllSessions(req.user.id, req.token);
    res.json({ ok: true });
  }),
);

meRouter.post(
  '/status',
  handle((req, res) => {
    const status = v.oneOf(req.body?.status, 'Status', ['active', 'paused']);
    getDb().prepare('UPDATE users SET status = ? WHERE id = ?').run(status, req.user.id);
    res.json(serializeMe(req.user.id));
  }),
);

meRouter.delete(
  '/',
  handle((req, res) => {
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(String(req.body?.password || ''), user.password_hash)) {
      throw new HttpError(403, 'Enter your password to delete your account.');
    }
    const files = [
      ...db.prepare('SELECT url FROM photos WHERE user_id = ?').all(user.id).map((r) => r.url),
      ...db.prepare('SELECT media_url AS url FROM moments WHERE user_id = ? AND media_url IS NOT NULL').all(user.id).map((r) => r.url),
    ];
    const selfies = db.prepare('SELECT selfie_path FROM verification_requests WHERE user_id = ?').all(user.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id); // cascades everywhere
    files.forEach(removeUploadedFile);
    selfies.forEach((s) => fs.rm(path.join(config.privateDir, path.basename(s.selfie_path)), { force: true }, () => {}));
    res.json({ ok: true });
  }),
);

meRouter.post(
  '/plus-interest',
  handle((req, res) => {
    getDb().prepare('UPDATE users SET plus_interest = 1 WHERE id = ?').run(req.user.id);
    res.json(serializeMe(req.user.id));
  }),
);

meRouter.get(
  '/verification/pose',
  handle((req, res) => {
    const pose = VERIFICATION_POSES[Math.floor(Math.random() * VERIFICATION_POSES.length)];
    res.json({ pose });
  }),
);

/**
 * Verification: the member submits a live selfie copying a random pose.
 * The request is queued for human review (see `npm run verify-user`).
 * We never mark someone verified automatically.
 */
meRouter.post(
  '/verification',
  privateUpload.single('selfie'),
  handle((req, res) => {
    if (!req.file) throw new HttpError(400, 'Take a selfie to continue.');
    const pose = v.str(req.body?.pose, 'Pose', { required: true, max: 80 });
    const db = getDb();
    const p = db.prepare('SELECT verification FROM profiles WHERE user_id = ?').get(req.user.id);
    if (p.verification === 'verified') throw new HttpError(400, 'You’re already verified.');
    tx(() => {
      db.prepare("UPDATE verification_requests SET status = 'superseded' WHERE user_id = ? AND status = 'pending'").run(req.user.id);
      db.prepare('INSERT INTO verification_requests (user_id, selfie_path, pose, created_at) VALUES (?, ?, ?, ?)').run(
        req.user.id, req.file.filename, pose, now(),
      );
      db.prepare("UPDATE profiles SET verification = 'pending' WHERE user_id = ?").run(req.user.id);
    });
    res.status(201).json(serializeMe(req.user.id));
  }),
);

/** Lightweight counters polled by the tab bar. */
meRouter.get(
  '/badges',
  handle((req, res) => {
    const db = getDb();
    const id = req.user.id;
    const notifications = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(id).n;
    const messages = db
      .prepare(
        `SELECT COUNT(*) AS n FROM messages m JOIN conversations c ON c.id = m.conversation_id
          WHERE (c.user_a = ? OR c.user_b = ?) AND c.closed = 0 AND m.sender_id != ? AND m.read_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = m.sender_id) OR (b.blocker_id = m.sender_id AND b.blocked_id = ?))`,
      )
      .get(id, id, id, id, id).n;
    const crushes = db
      .prepare(
        `SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL AND kind IN ('crush','deep_crush','mutual')`,
      )
      .get(id).n;
    const latest = db
      .prepare(
        `SELECT n.id, n.kind, n.body, n.actor_id, pr.name AS actor_name FROM notifications n
           LEFT JOIN profiles pr ON pr.user_id = n.actor_id
          WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 1`,
      )
      .get(id);
    res.json({ notifications, messages, crushes, latestNotification: latest || null });
  }),
);
