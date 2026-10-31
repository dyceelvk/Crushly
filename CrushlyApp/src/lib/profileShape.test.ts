import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profileShape } from './profileShape';

/**
 * The crash this exists to prevent: `Cannot read properties of undefined
 * (reading 'length')` inside UserProfileScreen, which renders as a blank white
 * page — no error state, no retry, no way back but the OS.
 */

test('a payload with only an id and a name still renders', () => {
  const p = profileShape({ id: 2, name: 'Ngozi' });
  assert.equal(p.name, 'Ngozi');
  // Everything a screen calls `.length` on is an array.
  assert.deepEqual(p.moments, []);
  assert.deepEqual(p.interests, []);
  assert.deepEqual(p.sharedInterests, []);
  assert.deepEqual(p.photos, []);
  assert.deepEqual(p.intentions, []);
  assert.deepEqual(p.languages, []);
});

test('a missing name is a name, not undefined in a headline', () => {
  assert.equal(profileShape({ id: 2 }).name, 'Someone');
  assert.equal(profileShape(null).name, 'Someone');
});

test('null jsonb columns become empty lists rather than throwing', () => {
  const p = profileShape({ id: 3, interests: null, languages: null, moments: null, photos: null, lifestyle: null });
  for (const key of ['interests', 'languages', 'moments', 'photos'] as const) {
    assert.ok(Array.isArray(p[key]), `${key} is an array`);
  }
  assert.deepEqual(p.lifestyle, {});
});

test('junk in a list is dropped, not passed through', () => {
  const p = profileShape({
    id: 4,
    interests: ['Music', 7, null, '', 'Design'],
    photos: [{ id: 1, url: 'a.jpg' }, { id: 2, url: '' }, 'nonsense', { url: 'b.jpg' }],
    intentions: ['dating', 'not-a-real-intention'],
  });
  assert.deepEqual(p.interests, ['Music', 'Design']);
  assert.deepEqual(p.photos.map((x) => x.url), ['a.jpg', 'b.jpg']);
  assert.deepEqual(p.intentions, ['dating']);
});

test('the crush state is a full object even when the payload has none', () => {
  const c = profileShape({ id: 5 }).crush;
  assert.deepEqual(c, { sent: false, sentDeep: false, received: false, receivedDeep: false, note: null, mutual: false });
  assert.deepEqual(profileShape({ id: 5, crush: { mutual: true } }).crush.mutual, true);
});

test('a lifestyle with one bad value keeps the good ones', () => {
  const l = profileShape({ id: 6, lifestyle: { work: 'Architect', height: 180, zodiac: 42, smoking: '' } }).lifestyle;
  assert.deepEqual(l, { work: 'Architect', height: 180 });
});

test('online is a three-state answer, and "unknown" is not "offline"', () => {
  assert.equal(profileShape({ id: 7, online: true }).online, true);
  assert.equal(profileShape({ id: 7, online: false }).online, false);
  assert.equal(profileShape({ id: 7 }).online, null);
});

test('a Moment without a style is still a Moment', () => {
  const [m] = profileShape({ id: 8, moments: [{ id: 9, kind: 'photo', mediaUrl: 'x.jpg', createdAt: 1 }] }).moments;
  assert.equal(m.kind, 'photo');
  assert.equal(m.style, 'noir');
  assert.equal(m.edit, null);
});

test('acceptsCrushes defaults to yes, because the alternative silently forbids nothing', () => {
  assert.equal(profileShape({ id: 9 }).acceptsCrushes, true);
  assert.equal(profileShape({ id: 9, acceptsCrushes: false }).acceptsCrushes, false);
});

test('a full payload is passed through unchanged', () => {
  const row = {
    id: 10,
    name: 'Ada',
    username: 'ada',
    age: 28,
    pronouns: 'she/her',
    city: 'Port Harcourt',
    verified: true,
    distance: '5 km',
    online: true,
    activity: 'Online now',
    bio: 'Designer.',
    intentions: ['dating'],
    relationshipIntention: 'Long-term partner',
    interests: ['Music'],
    sharedInterests: ['Coffee'],
    photos: [{ id: 1, url: 'a.jpg' }],
    crush: { sent: true, sentDeep: false, received: true, receivedDeep: false, note: 'hi', mutual: true },
    canMessage: true,
    acceptsCrushes: true,
    languages: ['English'],
    lifestyle: { height: 180 },
    messageBlockReason: null,
    moments: [],
  };
  assert.deepEqual(profileShape(row), { ...row, at: undefined });
});
