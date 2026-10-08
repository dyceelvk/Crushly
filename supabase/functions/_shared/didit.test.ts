import { test } from 'node:test';
import assert from 'node:assert/strict';

import { canonicalize, diditToAppStatus, verifyDiditWebhook } from './didit';

const SECRET = 'test-webhook-secret';

async function sign(rawBody: string, secret = SECRET): Promise<string> {
  const payload = JSON.parse(rawBody);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonicalize(payload)));
  return Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const now = () => String(Math.floor(Date.now() / 1000));

test('canonicalize sorts keys recursively and keeps array order', () => {
  assert.equal(canonicalize({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
  assert.equal(canonicalize({ list: [{ z: 1, y: 2 }, { b: 1, a: 2 }] }), '{"list":[{"y":2,"z":1},{"a":2,"b":1}]}');
});

test('canonicalize shortens whole-valued floats like Didit', () => {
  assert.equal(canonicalize(JSON.parse('{"score": 1.0, "ratio": 0.5}')), '{"ratio":0.5,"score":1}');
  assert.equal(canonicalize(JSON.parse('{"n": 100.0}')), '{"n":100}');
});

test('canonicalize keeps raw UTF-8 (ensure_ascii=False parity)', () => {
  assert.equal(canonicalize({ name: 'Adé' }), '{"name":"Adé"}');
});

test('verifyDiditWebhook accepts a correctly signed payload', async () => {
  const raw = JSON.stringify({ session_id: 'ses_1', status: 'Approved', vendor_data: '42', score: 98.0, nested: { b: 2, a: 1 } });
  const sig = await sign(raw);
  assert.equal(await verifyDiditWebhook(raw, sig, now(), SECRET), true);
});

test('verifyDiditWebhook is whitespace- and key-order-insensitive (canonical form)', async () => {
  const a = '{"a":1,"b":{"y":2,"x":1}}';
  const b = '{ "b": { "x": 1, "y": 2 }, "a": 1 }';
  const sig = await sign(a);
  assert.equal(await verifyDiditWebhook(b, sig, now(), SECRET), true);
});

test('verifyDiditWebhook rejects tampering, wrong secret, stale timestamp and junk', async () => {
  const raw = JSON.stringify({ session_id: 'ses_1', status: 'Approved' });
  const sig = await sign(raw);
  assert.equal(await verifyDiditWebhook(raw.replace('Approved', 'Declined'), sig, now(), SECRET), false);
  assert.equal(await verifyDiditWebhook(raw, await sign(raw, 'other-secret'), now(), SECRET), false);
  assert.equal(await verifyDiditWebhook(raw, sig, String(Math.floor(Date.now() / 1000) - 3600), SECRET), false);
  assert.equal(await verifyDiditWebhook(raw, sig, String(Math.floor(Date.now() / 1000) + 3600), SECRET), false);
  assert.equal(await verifyDiditWebhook('not json', sig, now(), SECRET), false);
  assert.equal(await verifyDiditWebhook(raw, null, now(), SECRET), false);
  assert.equal(await verifyDiditWebhook(raw, sig, null, SECRET), false);
  assert.equal(await verifyDiditWebhook(raw, sig, now(), ''), false);
});

test('diditToAppStatus maps the title-cased Didit statuses', () => {
  assert.equal(diditToAppStatus('Approved'), 'approved');
  assert.equal(diditToAppStatus('Declined'), 'rejected');
  assert.equal(diditToAppStatus('In Review'), 'pending');
  assert.equal(diditToAppStatus('Not Started'), 'pending');
  assert.equal(diditToAppStatus('In Progress'), 'pending');
  assert.equal(diditToAppStatus('Expired'), 'pending');
});
