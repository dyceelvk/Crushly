import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mediaKind } from './mediaHost';

const BASE = 'https://crushly-media.example.workers.dev';

/** Reloads the module with EXPO_PUBLIC_MEDIA_BASE_URL set (read at import). */
function loadWith(base: string | undefined): typeof import('./mediaHost') {
  const key = 'EXPO_PUBLIC_MEDIA_BASE_URL';
  const previous = process.env[key];
  if (base === undefined) delete process.env[key];
  else process.env[key] = base;
  delete require.cache[require.resolve('./mediaHost')];
  const mod = require('./mediaHost') as typeof import('./mediaHost');
  if (previous === undefined) delete process.env[key];
  else process.env[key] = previous;
  return mod;
}

test('mediaKind reads the folder that decides a file’s rules', () => {
  assert.equal(mediaKind('moments/12/a.jpg'), 'moments');
  assert.equal(mediaKind('photos/12/a.jpg'), 'photos');
  assert.equal(mediaKind('messages/12/a.m4a'), 'messages');
  assert.equal(mediaKind('/moments/12/a.jpg'), 'moments');
  assert.equal(mediaKind('secrets/12/a.jpg'), null);
  assert.equal(mediaKind(''), null);
});

test('with no base URL configured, media stays in Supabase Storage', () => {
  const mod = loadWith(undefined);
  assert.equal(mod.MEDIA_BASE_URL, '');
  assert.equal(mod.mediaStoreEnabled, false);
  assert.equal(mod.mediaStorePath(`${BASE}/m/photos/12/a.jpg`), null);
  assert.equal(mod.isMediaStoreUrl(`${BASE}/m/photos/12/a.jpg`), false);
});

test('stored paths become URLs and back again', () => {
  const mod = loadWith(BASE);
  assert.equal(mod.mediaStoreEnabled, true);
  assert.equal(mod.mediaStoreUrl('moments/12/a.jpg'), `${BASE}/m/moments/12/a.jpg`);
  // Spaces and other awkward characters survive the round trip.
  assert.equal(mod.mediaStoreUrl('moments/12/a b.jpg'), `${BASE}/m/moments/12/a%20b.jpg`);
  assert.equal(mod.mediaStorePath(`${BASE}/m/moments/12/a%20b.jpg`), 'moments/12/a b.jpg');
  assert.equal(mod.mediaStorePath(`${BASE}/m/moments/12/a.jpg?token=abc`), 'moments/12/a.jpg');
  assert.equal(mod.isMediaStoreUrl(`${BASE}/m/photos/12/a.jpg`), true);
});

test('a trailing slash in the configured URL does not produce //m/', () => {
  const mod = loadWith(`${BASE}/`);
  assert.equal(mod.MEDIA_BASE_URL, BASE);
  assert.equal(mod.mediaStoreUrl('photos/12/a.jpg'), `${BASE}/m/photos/12/a.jpg`);
});

test('files that are not ours are never treated as ours', () => {
  const mod = loadWith(BASE);
  assert.equal(mod.mediaStorePath('https://evil.example.com/m/photos/12/a.jpg'), null);
  assert.equal(mod.mediaStorePath('photos/12/a.jpg'), null);
  assert.equal(mod.mediaStorePath(`${BASE}/photos/12/a.jpg`), null); // missing /m/
});

test('the access token only ever goes to our own media host', () => {
  const mod = loadWith(BASE);
  mod.setMediaToken('tok_live');

  const ours = mod.mediaAuthHeaders(`${BASE}/m/messages/12/a.m4a`);
  assert.deepEqual(ours, { Authorization: 'Bearer tok_live' });
  assert.deepEqual(mod.mediaSource(`${BASE}/m/messages/12/a.m4a`), {
    uri: `${BASE}/m/messages/12/a.m4a`,
    headers: { Authorization: 'Bearer tok_live' },
  });

  // Someone else's CDN, and Supabase Storage paths, get no token at all.
  assert.equal(mod.mediaAuthHeaders('https://evil.example.com/m/a.jpg'), undefined);
  assert.equal(mod.mediaAuthHeaders('photos/12/a.jpg'), undefined);
  assert.equal(mod.mediaAuthHeaders(undefined), undefined);

  // Signed out: nothing is attached, so a stale token cannot leak either.
  mod.setMediaToken(null);
  assert.equal(mod.mediaAuthHeaders(`${BASE}/m/photos/12/a.jpg`), undefined);
  assert.equal(mod.mediaSource('photos/12/a.jpg'), 'photos/12/a.jpg');
});
