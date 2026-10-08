/**
 * Seeds a demo community so Crushly can be explored end to end.
 *
 *   npm run seed            # seed only if the database has no members
 *   npm run seed -- --reset # wipe the database and reseed
 *
 * Every demo member is a real account (password: crushly123), so you can sign
 * in as two of them in two browsers and test crushes and messaging for real.
 * Photos are AI-generated portraits of fictional people (server/seed/photos).
 */
import fs from 'node:fs';
import { config } from '../src/config.js';
import { getDb, now } from '../src/db.js';
import { createAccount } from '../src/routes/auth.js';
import { connect, ensureConversation, notify } from '../src/lib/social.js';

export const DEMO_PASSWORD = 'crushly123';

const H = 60 * 60 * 1000;
const yearsAgo = (age, month = 5, day = 14) => `${new Date().getUTCFullYear() - age - 1}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const MEMBERS = [
  {
    key: 'daniel', email: 'daniel@crushly.app', name: 'Daniel', age: 27, month: 2, city: 'Lekki, Lagos', lat: 6.44, lng: 3.47,
    pronouns: 'he/him', verified: true, active: 0.1,
    bio: 'Golden-hour chaser and amateur chef. Weekends are for long lunches, new playlists and getting lost somewhere new. Looking for someone who can hold a conversation and hold my hand.',
    intentions: ['dating', 'relationship'], rel: 'Long-term partner',
    interests: ['Travel', 'Food', 'Music', 'Photography', 'Cooking'], languages: ['English', 'Yoruba'],
    lifestyle: { work: 'Product designer', height: 182, workout: 'Sometimes', drinking: 'Socially', smoking: 'Never' },
  },
  {
    key: 'marcus', email: 'marcus@crushly.app', name: 'Marcus', age: 24, month: 9, city: 'Ikoyi, Lagos', lat: 6.45, lng: 3.43,
    pronouns: 'he/him', verified: true, active: 0.05,
    bio: 'Soft heart, strong coffee. Personal trainer by day, vinyl collector by night. I believe the best dates end with “we should do this again.”',
    intentions: ['dating', 'relationship'], rel: 'Long-term, open to short',
    interests: ['Music', 'Fitness', 'Fashion', 'Travel', 'Movies'], languages: ['English', 'Igbo'],
    lifestyle: { work: 'Personal trainer', height: 185, workout: 'Often', drinking: 'Rarely', smoking: 'Never', zodiac: 'Virgo' },
  },
  {
    key: 'tobi', email: 'tobi@crushly.app', name: 'Tobi', age: 26, month: 7, city: 'Yaba, Lagos', lat: 6.51, lng: 3.38,
    pronouns: 'he/him', verified: false, active: 0.02,
    bio: 'Making beats you will hear at your cousin’s wedding. Late-night studio sessions, Afrobeats, and long voice notes.',
    intentions: ['dating', 'new_connections', 'friends'], rel: 'Still figuring it out',
    interests: ['Music', 'Afrobeats', 'Nightlife', 'Gaming', 'Art'], languages: ['English', 'Yoruba'],
    lifestyle: { work: 'Music producer', workout: 'Rarely', drinking: 'Socially' },
  },
  {
    key: 'ryan', email: 'ryan@crushly.app', name: 'Ryan', age: 28, month: 11, city: 'Victoria Island, Lagos', lat: 6.43, lng: 3.42,
    pronouns: 'he/him', verified: true, active: 3,
    bio: 'London-born, Lagos-curious. Here for two years with work and determined to find the best suya in the city. Recommendations (and company) welcome.',
    intentions: ['dating', 'friends'], rel: 'Short-term, open to long',
    interests: ['Travel', 'Food', 'Wine', 'Books', 'Football'], languages: ['English', 'French'],
    lifestyle: { work: 'Consultant', education: 'University of Edinburgh', height: 179, drinking: 'Socially', pets: 'Dog person' },
  },
  {
    key: 'ade', email: 'ade@crushly.app', name: 'Ade', age: 31, month: 4, city: 'Ikoyi, Lagos', lat: 6.46, lng: 3.44,
    pronouns: 'he/him', verified: true, active: 0.5,
    bio: 'Architect. I like clean lines, honest people and Sunday mornings that never end. Ask me about the building I’d save in a fire.',
    intentions: ['relationship'], rel: 'Long-term partner',
    interests: ['Design', 'Art', 'Coffee', 'Books', 'Travel'], languages: ['English', 'Yoruba', 'French'],
    lifestyle: { work: 'Architect', education: 'AA School, London', workout: 'Sometimes', drinking: 'Rarely', smoking: 'Never', zodiac: 'Taurus' },
  },
  {
    key: 'luca', email: 'luca@crushly.app', name: 'Luca', age: 29, month: 6, city: 'Victoria Island, Lagos', lat: 6.42, lng: 3.41,
    pronouns: 'he/him', verified: false, active: 8,
    bio: 'Milanese designer, adopted Lagosian. Espresso snob, terrible dancer, excellent listener.',
    intentions: ['dating', 'casual'], rel: 'Something casual',
    interests: ['Fashion', 'Design', 'Wine', 'Art', 'Dancing'], languages: ['Italian', 'English', 'French'],
    lifestyle: { work: 'Fashion designer', drinking: 'Socially', smoking: 'Socially' },
  },
  {
    key: 'kelechi', email: 'kelechi@crushly.app', name: 'Kelechi', age: 29, month: 1, city: 'Surulere, Lagos', lat: 6.50, lng: 3.35,
    pronouns: 'he/him', verified: false, active: 1.5,
    bio: 'Big laugh, bigger heart. Football on Saturdays, church choir on Sundays, jollof debates any day of the week.',
    intentions: ['relationship', 'dating'], rel: 'Long-term partner',
    interests: ['Fitness', 'Football', 'Music', 'Food', 'Sports'], languages: ['English', 'Igbo'],
    lifestyle: { work: 'Civil engineer', height: 188, workout: 'Often', drinking: 'Never', smoking: 'Never' },
  },
  {
    key: 'jayden', email: 'jayden@crushly.app', name: 'Jayden', age: 23, month: 12, city: 'Ikeja, Lagos', lat: 6.60, lng: 3.35,
    pronouns: 'he/they', verified: false, active: 0.03,
    bio: 'Final-year comp-sci, part-time anime critic. I will absolutely beat you at Mario Kart, then buy you shawarma to make up for it.',
    intentions: ['friends', 'new_connections', 'dating'], rel: 'New friends',
    interests: ['Gaming', 'Tech', 'Movies', 'Music', 'Food'], languages: ['English'],
    lifestyle: { education: 'UNILAG', workout: 'Rarely', drinking: 'Rarely' },
  },
  {
    key: 'femi', email: 'femi@crushly.app', name: 'Femi', age: 25, month: 3, city: 'Lekki, Lagos', lat: 6.45, lng: 3.50,
    pronouns: 'he/him', verified: false, active: 20,
    bio: 'Chef de partie with a soft spot for pepper soup and old Fela records. The way to my heart is… well, you know.',
    intentions: ['dating', 'casual', 'friends'], rel: 'Short-term, open to long',
    interests: ['Cooking', 'Food', 'Music', 'Afrobeats', 'Nightlife'], languages: ['English', 'Yoruba'],
    lifestyle: { work: 'Chef', workout: 'Sometimes', drinking: 'Socially' },
  },
  {
    key: 'seun', email: 'seun@crushly.app', name: 'Seun', age: 30, month: 8, city: 'Ikoyi, Lagos', lat: 6.45, lng: 3.44,
    pronouns: 'he/him', verified: true, active: 30,
    bio: 'Corporate lawyer who reads poetry on the third mainland bridge. Discreet, warm, and very good at choosing restaurants.',
    intentions: ['relationship', 'dating'], rel: 'Long-term partner',
    interests: ['Books', 'Wine', 'Theatre', 'Business', 'Travel'], languages: ['English', 'Yoruba', 'French'],
    lifestyle: { work: 'Lawyer', education: 'Lagos Law School', height: 180, drinking: 'Socially', smoking: 'Never', zodiac: 'Leo' },
  },
];

export function seed({ reset = false, quiet = false } = {}) {
  const log = (...a) => !quiet && console.log(...a);
  const db = getDb();
  if (reset) {
    db.exec('PRAGMA foreign_keys = OFF');
    for (const t of ['message_reactions', 'messages', 'conversations', 'moment_reactions', 'moment_views', 'moments', 'notifications', 'connections', 'crushes', 'passes', 'blocks', 'reports', 'verification_requests', 'photos', 'preferences', 'privacy', 'notification_settings', 'profiles', 'sessions', 'users']) {
      db.exec(`DELETE FROM ${t}`);
    }
    db.exec("DELETE FROM sqlite_sequence");
    db.exec('PRAGMA foreign_keys = ON');
  } else if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) {
    log('Database already has members — skipping seed. Use --reset to start over.');
    return false;
  }

  const t = now();
  const ids = {};
  for (const m of MEMBERS) {
    const id = createAccount(m.email, DEMO_PASSWORD, { isDemo: true });
    ids[m.key] = id;
    db.prepare(
      `UPDATE profiles SET name = ?, birthdate = ?, pronouns = ?, bio = ?, city = ?, lat = ?, lng = ?, intentions = ?,
         interests = ?, languages = ?, relationship_intention = ?, lifestyle = ?, verification = ?, onboarded = 1, updated_at = ?
       WHERE user_id = ?`,
    ).run(
      m.name, yearsAgo(m.age, m.month), m.pronouns, m.bio, m.city, m.lat, m.lng, JSON.stringify(m.intentions),
      JSON.stringify(m.interests), JSON.stringify(m.languages), m.rel, JSON.stringify(m.lifestyle),
      m.verified ? 'verified' : 'none', t, id,
    );
    db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(t - m.active * H, id);
    db.prepare('UPDATE preferences SET age_min = 21, age_max = 40, max_distance = 50 WHERE user_id = ?').run(id);
    [`/seed/${m.key}.jpg`, `/seed/${m.key}-2.jpg`].forEach((url, i) => {
      if (fs.existsSync(`${config.seedPhotosDir}/${url.slice(6)}`)) {
        db.prepare('INSERT INTO photos (user_id, url, position, created_at) VALUES (?, ?, ?, ?)').run(id, url, i, t);
      }
    });
  }

  const crush = (from, to, { deep = false, note = null, ago = 1 } = {}) => {
    db.prepare('INSERT OR IGNORE INTO crushes (from_id, to_id, deep, note, created_at) VALUES (?, ?, ?, ?, ?)').run(ids[from], ids[to], deep ? 1 : 0, note, t - ago * H);
    notify(ids[to], deep ? 'deep_crush' : 'crush', { actorId: ids[from], body: note || '' });
  };
  const mutual = (a, b, ago) => {
    crush(a, b, { ago: ago + 1 });
    crush(b, a, { ago });
    connect(ids[a], ids[b]);
    notify(ids[a], 'mutual', { actorId: ids[b] });
    notify(ids[b], 'mutual', { actorId: ids[a] });
  };
  const chat = (a, b, lines, startAgo) => {
    const conv = ensureConversation(ids[a], ids[b]);
    let at = t - startAgo * H;
    for (const [who, body, read = true] of lines) {
      at += 7 * 60 * 1000;
      db.prepare('INSERT INTO messages (conversation_id, sender_id, kind, body, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        conv.id, ids[who], 'text', body, at, read ? at + 60 * 1000 : null,
      );
    }
    db.prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?').run(at, conv.id);
    return conv.id;
  };

  // Daniel (the demo account) has people crushing on him — crush back on Marcus for a Mutual Crush.
  crush('marcus', 'daniel', { ago: 2 });
  crush('kelechi', 'daniel', { deep: true, note: 'That rooftop photo. I need the location — and maybe a tour guide?', ago: 5 });
  crush('tobi', 'daniel', { ago: 9 });
  crush('jayden', 'daniel', { ago: 26 });
  crush('daniel', 'luca', { ago: 30 });
  crush('daniel', 'femi', { ago: 40 });

  mutual('daniel', 'ryan', 50);
  mutual('daniel', 'ade', 20);
  mutual('marcus', 'seun', 70);
  crush('luca', 'marcus', { ago: 12 });
  crush('femi', 'tobi', { ago: 4 });

  chat('ryan', 'daniel', [
    ['ryan', 'Okay, I have to ask — where was your second photo taken? That skyline is unreal.'],
    ['daniel', 'Ha, a rooftop in Lekki. I can show you sometime if you promise not to tell everyone.'],
    ['ryan', 'Sworn to secrecy. Also still on my quest for the best suya in Lagos. Any leads?'],
    ['daniel', 'You’re asking a dangerous question. Glover Road, Friday night. Bring an appetite.'],
    ['ryan', 'It’s a date. Well — a suya date.', false],
  ], 30);
  chat('ade', 'daniel', [
    ['daniel', 'Your bio got me. Which building would you save in a fire?'],
    ['ade', 'The National Theatre, no hesitation. It’s a flawed masterpiece — like most good things.'],
    ['ade', 'Your turn. What’s the meal you’d cook to impress someone?', false],
  ], 6);
  chat('marcus', 'seun', [
    ['seun', 'Dinner Thursday?'],
    ['marcus', 'Only if I get to pick dessert.'],
  ], 40);

  // Moments (expire 24h after creation).
  const moment = (who, kind, body, { media = null, style = 'noir', ago = 1, audience = 'everyone' } = {}) => {
    const created = t - ago * H;
    db.prepare('INSERT INTO moments (user_id, kind, body, media_url, style, audience, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      ids[who], kind, body, media, style, audience, created, created + config.momentLifetimeMs,
    );
  };
  moment('marcus', 'photo', 'Sunday reset. Who’s joining me for a run tomorrow?', { media: '/seed/marcus-2.jpg', ago: 2 });
  moment('tobi', 'text', 'Studio till 3am again. New track drops Friday — be honest with me.', { style: 'crimson', ago: 4 });
  moment('ryan', 'photo', 'Wine bar discovery of the year 🍷', { media: '/seed/ryan-2.jpg', ago: 6 });
  moment('ade', 'text', 'A city is a conversation between the people who built it and the people who live in it.', { style: 'champagne', ago: 3 });
  moment('femi', 'photo', 'Tasting menu night. Pepper soup, reimagined.', { media: '/seed/femi-2.jpg', ago: 9 });
  moment('kelechi', 'photo', 'Leg day. Pray for me.', { media: '/seed/kelechi-2.jpg', ago: 1 });
  moment('jayden', 'text', 'Hot take: the Lagos traffic is a free podcast-listening session.', { style: 'midnight', ago: 11 });

  // Align notification times with the events they describe; older ones are already read.
  db.exec(`UPDATE notifications SET created_at = COALESCE((SELECT c.created_at FROM crushes c
             WHERE c.from_id = notifications.actor_id AND c.to_id = notifications.user_id), created_at)
           WHERE kind IN ('crush', 'deep_crush', 'mutual')`);
  db.prepare("UPDATE notifications SET read_at = ? WHERE created_at < ? OR kind = 'mutual'").run(t, t - 24 * H);

  log(`Seeded ${MEMBERS.length} members. Sign in as daniel@crushly.app / ${DEMO_PASSWORD}`);
  return true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed({ reset: process.argv.includes('--reset') });
}
