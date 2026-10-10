import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mediaKind } from './mediaHost';

const BASE = 'https://crushly-media.example.workers.dev';

/** Reloads the module with the given env (both are read at import time). */
function loadWith(base?: string, kinds?: string): typeof import('./mediaHost') {
  const previousBase = process.env.EXPO_PUBLIC_MEDIA_BASE_URL;
  const previousKinds = process.env.EXPO_PUBLIC_MEDIA_KINDS;
  if (base === undefined) delete process.env.EXPO_PUBLIC_MEDIA_BASE_URL;
  else process.env.EXPO_PUBLIC_MEDIA_BASE_URL = base;
  if (kinds === undefined) delete process.env.EXPO_PUBLIC_MEDIA_KINDS;
  else process.env.EXPO_PUBLIC_MEDIA_KINDS = kinds;

  delete require.cache[require.resolve('./mediaHost')];
  const mod = require('./mediaHost') as typeof import('./mediaHost');

  if (previousBase === undefined) delete process.env.EXPO_PUBLIC_MEDIA_BASE_URL;
  else process.env.EXPO_PUBLIC_MEDIA_BASE_URL = previousBase;
  if (previousKinds === undefined) delete process.env.EXPO_PUBLIC_MEDIA_KINDS;
  else process.env.EXPO_PUBLIC_MEDIA_KINDS = previousKinds;
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

test('the deployed Worker is used with no configuration at all', () => {
  const mod = loadWith(undefined, undefined);
  assert.equal(mod.mediaStoreEnabled, true);
  assert.match(mod.MEDIA_BASE_URL, /^https:\/\/.+/);
});

test('setting the base URL to empty switches the object store off', () => {
  const mod = loadWith('', undefined);
  assert.equal(mod.mediaStoreEnabled, false);
  assert.equal(mod.mediaStorePath(`${BASE}/m/photos/12/a.jpg`), null);
  assert.equal(mod.isMediaStoreUrl(`${BASE}/m/photos/12/a.jpg`), false);
  assert.equal(mod.moved('moments'), false);
});

test('every kind moves by default; the list can pull one back', () => {
  let mod = loadWith(BASE, undefined);
  assert.deepEqual(mod.MEDIA_KINDS, ['photos', 'moments', 'messages', 'posts', 'circles']);
  assert.equal(mod.moved('photos'), true);
  assert.equal(mod.moved('moments'), true);
  assert.equal(mod.moved('messages'), true);
  assert.equal(mod.moved('posts'), true);
  assert.equal(mod.moved('circles'), true);

  // Moving one kind back to Supabase is a config change, never a code change.
  mod = loadWith(BASE, 'moments');
  assert.equal(mod.moved('moments'), true);
  assert.equal(mod.moved('photos'), false);
  assert.equal(mod.moved('messages'), false);

  // Junk in the list is dropped rather than trusted.
  mod = loadWith(BASE, 'moments, secrets ');
  assert.deepEqual(mod.MEDIA_KINDS, ['moments']);

  // An empty list means nothing has moved, but the store itself stays on.
  mod = loadWith(BASE, '');
  assert.deepEqual(mod.MEDIA_KINDS, []);
  assert.equal(mod.moved('moments'), false);
});

test('stored paths become URLs and back again', () => {
  const mod = loadWith(BASE, 'moments');
  assert.equal(mod.mediaStoreUrl('moments/12/a.jpg'), `${BASE}/m/moments/12/a.jpg`);
  // Spaces and other awkward characters survive the round trip.
  assert.equal(mod.mediaStoreUrl('moments/12/a b.jpg'), `${BASE}/m/moments/12/a%20b.jpg`);
  assert.equal(mod.mediaStorePath(`${BASE}/m/moments/12/a%20b.jpg`), 'moments/12/a b.jpg');
  assert.equal(mod.mediaStorePath(`${BASE}/m/moments/12/a.jpg?token=abc`), 'moments/12/a.jpg');
  assert.equal(mod.isMediaStoreUrl(`${BASE}/m/photos/12/a.jpg`), true);
});

test('a trailing slash in the configured URL does not produce //m/', () => {
  const mod = loadWith(`${BASE}/`, 'moments');
  assert.equal(mod.MEDIA_BASE_URL, BASE);
  assert.equal(mod.mediaStoreUrl('photos/12/a.jpg'), `${BASE}/m/photos/12/a.jpg`);
});

test('files that are not ours are never treated as ours', () => {
  const mod = loadWith(BASE, 'moments');
  assert.equal(mod.mediaStorePath('https://evil.example.com/m/photos/12/a.jpg'), null);
  assert.equal(mod.mediaStorePath('photos/12/a.jpg'), null);
  assert.equal(mod.mediaStorePath(`${BASE}/photos/12/a.jpg`), null); // missing /m/
});

test('native sends the token as a header; the web puts it in the URL', () => {
  let mod = loadWith(BASE, 'moments');
  mod.setMediaToken('tok_live');

  // Default (native): header only, and only to our own host.
  assert.deepEqual(mod.mediaAuthHeaders(`${BASE}/m/messages/12/a.m4a`), {
    Authorization: 'Bearer tok_live',
  });
  assert.deepEqual(mod.mediaSource(`${BASE}/m/messages/12/a.m4a`), {
    uri: `${BASE}/m/messages/12/a.m4a`,
    headers: { Authorization: 'Bearer tok_live' },
  });

  // Web: browsers cannot set headers on an <img>, so it rides in the query.
  mod.setMediaTokenTransport(true);
  assert.equal(mod.mediaStoreUrl('moments/12/a.jpg'), `${BASE}/m/moments/12/a.jpg?token=tok_live`);
  assert.equal(mod.mediaSource(`${BASE}/m/moments/12/a.jpg`), `${BASE}/m/moments/12/a.jpg?token=tok_live`);
  // An existing token in the URL is replaced, not appended twice.
  assert.equal(
    mod.mediaSource(`${BASE}/m/moments/12/a.jpg?token=stale`),
    `${BASE}/m/moments/12/a.jpg?token=tok_live`,
  );
  mod.setMediaTokenTransport(false);
});

test('the access token only ever goes to our own media host', () => {
  const mod = loadWith(BASE, 'moments');
  mod.setMediaToken('tok_live');
  assert.equal(mod.mediaAuthHeaders('https://evil.example.com/m/a.jpg'), undefined);
  assert.equal(mod.mediaAuthHeaders('photos/12/a.jpg'), undefined);
  assert.equal(mod.mediaAuthHeaders(undefined), undefined);

  // Signed out: nothing is attached, so a stale token cannot leak either.
  mod.setMediaToken(null);
  assert.equal(mod.mediaAuthHeaders(`${BASE}/m/photos/12/a.jpg`), undefined);
  assert.equal(mod.mediaSource('photos/12/a.jpg'), 'photos/12/a.jpg');
});
