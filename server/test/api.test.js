import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crushly-test-'));
process.env.CRUSHLY_DATA_DIR = dataDir;
process.env.CRUSHLY_WEB_DIST = path.join(dataDir, 'no-web');

const { createApp } = await import('../src/app.js');

let server;
let base;
// 1x1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function call(method, url, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(base + url, { method, headers, body: payload });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

async function member(email, profile) {
  const signup = await call('POST', '/auth/signup', { body: { email, password: 'password123' } });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  const token = signup.body.token;
  const patch = await call('PATCH', '/me/profile', { token, body: profile });
  assert.equal(patch.status, 200, JSON.stringify(patch.body));
  const form = new FormData();
  form.append('photo', new Blob([PNG], { type: 'image/png' }), 'p.png');
  const up = await call('POST', '/me/photos', { token, form });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  const done = await call('POST', '/me/onboarding/complete', { token });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  return { token, id: signup.body.me.id };
}

const birth = (age) => `${new Date().getUTCFullYear() - age - 1}-03-10`;
let alex;
let sam;

test('signup validates input and rejects duplicates', async () => {
  assert.equal((await call('POST', '/auth/signup', { body: { email: 'bad', password: 'password123' } })).status, 400);
  assert.equal((await call('POST', '/auth/signup', { body: { email: 'a@b.co', password: 'short' } })).status, 400);
  alex = await member('alex@test.dev', {
    name: 'Alex', birthdate: birth(26), city: 'Lagos', location: { lat: 6.4512345, lng: 3.4298765 },
    interests: ['Music', 'Travel'], intentions: ['dating'],
  });
  const dup = await call('POST', '/auth/signup', { body: { email: 'ALEX@test.dev', password: 'password123' } });
  assert.equal(dup.status, 409);
});

test('onboarding requires essentials and rejects minors', async () => {
  const s = await call('POST', '/auth/signup', { body: { email: 'young@test.dev', password: 'password123' } });
  const token = s.body.token;
  const minor = await call('PATCH', '/me/profile', { token, body: { birthdate: birth(16) } });
  assert.equal(minor.status, 400);
  assert.match(minor.body.error.message, /18/);
  const incomplete = await call('POST', '/me/onboarding/complete', { token });
  assert.equal(incomplete.status, 400);
});

test('login, session and logout', async () => {
  const bad = await call('POST', '/auth/login', { body: { email: 'alex@test.dev', password: 'nope-nope' } });
  assert.equal(bad.status, 401);
  const ok = await call('POST', '/auth/login', { body: { email: 'alex@test.dev', password: 'password123' } });
  assert.equal(ok.status, 200);
  assert.equal((await call('GET', '/me', { token: ok.body.token })).body.profile.name, 'Alex');
  await call('POST', '/auth/logout', { token: ok.body.token });
  assert.equal((await call('GET', '/me', { token: ok.body.token })).status, 401);
});

test('discover returns approximate distance, never coordinates', async () => {
  sam = await member('sam@test.dev', {
    name: 'Sam', birthdate: birth(28), city: 'Lagos', location: { lat: 6.5, lng: 3.38 },
    interests: ['Music', 'Fitness'], intentions: ['dating', 'friends'],
  });
  const d = await call('GET', '/discover', { token: alex.token });
  assert.equal(d.status, 200);
  const found = d.body.items.find((p) => p.id === sam.id);
  assert.ok(found, 'Sam should be discoverable');
  assert.equal(found.lat, undefined);
  assert.equal(found.lng, undefined);
  assert.equal(found.birthdate, undefined);
  assert.match(found.distance, /km/);
  assert.deepEqual(found.sharedInterests, ['Music']);

  await call('PATCH', '/me/privacy', { token: sam.token, body: { showDistance: false } });
  const again = await call('GET', '/discover', { token: alex.token });
  assert.equal(again.body.items.find((p) => p.id === sam.id).distance, null);
});

test('messaging is restricted until a Mutual Crush', async () => {
  const denied = await call('POST', '/conversations', { token: alex.token, body: { userId: sam.id } });
  assert.equal(denied.status, 403);
  assert.match(denied.body.error.message, /Mutual Crush/);
});

test('crush → mutual crush → notifications', async () => {
  const first = await call('POST', `/users/${sam.id}/crush`, { token: alex.token });
  assert.equal(first.status, 200);
  assert.equal(first.body.mutual, false);
  const crushes = await call('GET', '/crushes', { token: sam.token });
  assert.ok(crushes.body.incoming.some((p) => p.id === alex.id));

  const back = await call('POST', `/users/${alex.id}/crush`, { token: sam.token });
  assert.equal(back.body.mutual, true);
  assert.equal(back.body.isNew, true);

  const n = await call('GET', '/notifications', { token: alex.token });
  assert.ok(n.body.items.some((x) => x.kind === 'mutual' && x.actor.id === sam.id));
  const mine = await call('GET', '/crushes', { token: alex.token });
  assert.ok(mine.body.mutual.some((p) => p.id === sam.id));
});

test('deep crushes are limited per day for free members', async () => {
  const others = [];
  for (let i = 0; i < 4; i += 1) {
    others.push(await member(`deep${i}@test.dev`, { name: `Deep${i}`, birthdate: birth(25) }));
  }
  for (let i = 0; i < 3; i += 1) {
    assert.equal((await call('POST', `/users/${others[i].id}/crush`, { token: alex.token, body: { deep: true } })).status, 200);
  }
  const fourth = await call('POST', `/users/${others[3].id}/crush`, { token: alex.token, body: { deep: true } });
  assert.equal(fourth.status, 429);
  assert.equal(fourth.body.error.code, 'deep_limit');
});

let convId;
test('messages, read receipts and crush reactions', async () => {
  const conv = await call('POST', '/conversations', { token: alex.token, body: { userId: sam.id } });
  assert.equal(conv.status, 200);
  convId = conv.body.id;
  const sent = await call('POST', `/conversations/${convId}/messages`, { token: alex.token, body: { kind: 'text', body: 'Hey Sam' } });
  assert.equal(sent.status, 201);
  assert.equal(sent.body.readAt, null);

  const badges = await call('GET', '/me/badges', { token: sam.token });
  assert.equal(badges.body.messages, 1);

  await call('POST', `/conversations/${convId}/read`, { token: sam.token });
  const history = await call('GET', `/conversations/${convId}/messages`, { token: alex.token });
  assert.ok(history.body.items[0].readAt, 'read receipt visible when both allow it');

  await call('PATCH', '/me/privacy', { token: sam.token, body: { readReceipts: false } });
  const hidden = await call('GET', `/conversations/${convId}/messages`, { token: alex.token });
  assert.equal(hidden.body.items[0].readAt, null, 'receipts are reciprocal');

  const react = await call('POST', `/messages/${sent.body.id}/react`, { token: sam.token, body: { kind: 'crush' } });
  assert.equal(react.body.reactions[0].kind, 'crush');

  const sticker = await call('POST', `/conversations/${convId}/messages`, { token: sam.token, body: { kind: 'sticker', sticker: 'wave' } });
  assert.equal(sticker.status, 201);

  const form = new FormData();
  form.append('kind', 'photo');
  form.append('media', new Blob([PNG], { type: 'image/png' }), 'x.png');
  const photo = await call('POST', `/conversations/${convId}/messages`, { token: alex.token, form });
  assert.equal(photo.status, 201);
  assert.match(photo.body.mediaUrl, /^\/uploads\//);
});

test('moments: post, view, react, reply', async () => {
  const post = await call('POST', '/moments', { token: sam.token, body: { body: 'Good energy only', style: 'champagne' } });
  assert.equal(post.status, 201);
  const feed = await call('GET', '/moments', { token: alex.token });
  const group = feed.body.others.find((g) => g.user.id === sam.id);
  assert.ok(group && group.hasUnseen);
  await call('POST', `/moments/${post.body.id}/view`, { token: alex.token });
  const react = await call('POST', `/moments/${post.body.id}/react`, { token: alex.token, body: { kind: 'crush' } });
  assert.equal(react.body.myReaction, 'crush');
  const reply = await call('POST', `/moments/${post.body.id}/reply`, { token: alex.token, body: { body: 'Love this' } });
  assert.equal(reply.body.conversationId, convId);
  const mine = await call('GET', '/moments', { token: sam.token });
  assert.equal(mine.body.mine.moments[0].viewCount, 1);
  const n = await call('GET', '/notifications', { token: sam.token });
  assert.ok(n.body.items.some((x) => x.kind === 'moment_reply'));
});

test('report and block hide members everywhere', async () => {
  const report = await call('POST', `/users/${sam.id}/report`, { token: alex.token, body: { reason: 'harassment', details: 'test', alsoBlock: true } });
  assert.equal(report.status, 201);
  assert.equal((await call('GET', `/users/${sam.id}`, { token: alex.token })).status, 404);
  assert.equal((await call('GET', `/users/${alex.id}`, { token: sam.token })).status, 404);
  const convs = await call('GET', '/conversations', { token: sam.token });
  assert.equal(convs.body.items.length, 0);
  const moments = await call('GET', '/moments', { token: alex.token });
  assert.ok(!moments.body.others.some((g) => g.user.id === sam.id));
  const blocks = await call('GET', '/blocks', { token: alex.token });
  assert.equal(blocks.body.items[0].id, sam.id);
  await call('DELETE', `/users/${sam.id}/block`, { token: alex.token });
  assert.equal((await call('GET', `/users/${sam.id}`, { token: alex.token })).status, 200);
});

test('hidden profiles leave Discover; incognito is honestly gated', async () => {
  await call('PATCH', '/me/privacy', { token: alex.token, body: { discoverable: false } });
  const d = await call('GET', '/discover', { token: sam.token });
  assert.ok(!d.body.items.some((p) => p.id === alex.id));
  const inc = await call('PATCH', '/me/privacy', { token: alex.token, body: { incognito: true } });
  assert.equal(inc.status, 402);
});

test('verification queues for human review instead of auto-approving', async () => {
  const form = new FormData();
  form.append('pose', 'Give a thumbs up');
  form.append('selfie', new Blob([PNG], { type: 'image/png' }), 's.png');
  const res = await call('POST', '/me/verification', { token: alex.token, form });
  assert.equal(res.status, 201);
  assert.equal(res.body.verification.status, 'pending');
});

test('account deletion requires password and removes the member', async () => {
  assert.equal((await call('DELETE', '/me', { token: sam.token, body: { password: 'wrong' } })).status, 403);
  assert.equal((await call('DELETE', '/me', { token: sam.token, body: { password: 'password123' } })).status, 200);
  assert.equal((await call('POST', '/auth/login', { body: { email: 'sam@test.dev', password: 'password123' } })).status, 401);
});
