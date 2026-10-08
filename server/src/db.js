import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

/**
 * Crushly persistence layer.
 *
 * SQLite (via Node's built-in `node:sqlite`) keeps the API dependency-free and
 * easy to run anywhere. Every query goes through prepared statements. Swapping
 * to Postgres later only requires re-implementing this module's `db` surface.
 */

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash   TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active',      -- active | paused
  is_demo         INTEGER NOT NULL DEFAULT 0,
  plus_interest   INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  last_active_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS profiles (
  user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL DEFAULT '',
  birthdate      TEXT,                                 -- YYYY-MM-DD, never exposed
  pronouns       TEXT NOT NULL DEFAULT '',
  bio            TEXT NOT NULL DEFAULT '',
  city           TEXT NOT NULL DEFAULT '',
  lat            REAL,                                 -- rounded to ~1km grid, never exposed
  lng            REAL,
  intentions     TEXT NOT NULL DEFAULT '[]',           -- JSON array
  interests      TEXT NOT NULL DEFAULT '[]',
  languages      TEXT NOT NULL DEFAULT '[]',
  relationship_intention TEXT NOT NULL DEFAULT '',
  lifestyle      TEXT NOT NULL DEFAULT '{}',           -- JSON object, every field optional
  verification   TEXT NOT NULL DEFAULT 'none',         -- none | pending | verified | rejected
  onboarded      INTEGER NOT NULL DEFAULT 0,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS photos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_photos_user ON photos(user_id, position);

CREATE TABLE IF NOT EXISTS preferences (
  user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  age_min      INTEGER NOT NULL DEFAULT 18,
  age_max      INTEGER NOT NULL DEFAULT 45,
  max_distance INTEGER NOT NULL DEFAULT 50,            -- km; 0 = anywhere
  intentions   TEXT NOT NULL DEFAULT '[]',
  interests    TEXT NOT NULL DEFAULT '[]',
  verified_only INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS privacy (
  user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  show_distance      INTEGER NOT NULL DEFAULT 1,
  show_online        INTEGER NOT NULL DEFAULT 1,
  read_receipts      INTEGER NOT NULL DEFAULT 1,
  discoverable       INTEGER NOT NULL DEFAULT 1,       -- appears in Discover
  profile_visibility TEXT NOT NULL DEFAULT 'everyone', -- everyone | connections
  who_can_message    TEXT NOT NULL DEFAULT 'mutual',   -- everyone | crushes | mutual
  who_can_crush      TEXT NOT NULL DEFAULT 'everyone', -- everyone | verified
  show_age           INTEGER NOT NULL DEFAULT 1,
  show_city          INTEGER NOT NULL DEFAULT 1,
  incognito          INTEGER NOT NULL DEFAULT 0        -- Crushly Plus (not purchasable yet)
);

CREATE TABLE IF NOT EXISTS notification_settings (
  user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  messages         INTEGER NOT NULL DEFAULT 1,
  crushes          INTEGER NOT NULL DEFAULT 1,
  moments          INTEGER NOT NULL DEFAULT 1,
  recommendations  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS crushes (
  from_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deep       INTEGER NOT NULL DEFAULT 0,
  note       TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (from_id, to_id)
);
CREATE INDEX IF NOT EXISTS idx_crushes_to ON crushes(to_id, created_at);

CREATE TABLE IF NOT EXISTS passes (
  from_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (from_id, to_id)
);

CREATE TABLE IF NOT EXISTS connections (
  user_a     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- always the lower id
  user_b     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_a, user_b)
);

CREATE TABLE IF NOT EXISTS conversations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_a     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_message_at INTEGER,
  closed     INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_a, user_b)
);

CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL DEFAULT 'text',       -- text | photo | voice | sticker | profile | moment_reply
  body            TEXT NOT NULL DEFAULT '',
  media_url       TEXT,
  meta            TEXT NOT NULL DEFAULT '{}',
  created_at      INTEGER NOT NULL,
  read_at         INTEGER
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);

CREATE TABLE IF NOT EXISTS message_reactions (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'crush',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS moments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,                           -- photo | text
  body       TEXT NOT NULL DEFAULT '',
  media_url  TEXT,
  style      TEXT NOT NULL DEFAULT 'noir',
  audience   TEXT NOT NULL DEFAULT 'everyone',        -- everyone | connections
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_moments_user ON moments(user_id, expires_at);

CREATE TABLE IF NOT EXISTS moment_views (
  moment_id INTEGER NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (moment_id, user_id)
);

CREATE TABLE IF NOT EXISTS moment_reactions (
  moment_id INTEGER NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (moment_id, user_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,       -- crush | deep_crush | mutual | message | moment_reply | moment_reaction | verified
  actor_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
  ref_id     INTEGER,
  body       TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  read_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, id);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL,
  details     TEXT NOT NULL DEFAULT '',
  context     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'open',  -- open | reviewing | resolved
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_requests (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  selfie_path TEXT NOT NULL,           -- private, never served publicly
  pose       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER
);
`;

let instance = null;

export function openDb(file = config.dbFile) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return db;
}

export function getDb() {
  if (!instance) instance = openDb();
  return instance;
}

export function setDb(db) {
  instance = db;
}

/** Run `fn` inside a transaction; rolls back on throw. */
export function tx(fn) {
  const db = getDb();
  db.exec('BEGIN');
  try {
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export const now = () => Date.now();

export function parseJson(value, fallback) {
  if (value == null) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
