import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spaceShareUrl, sharedSpaceId } from './spaceShare';

const TOKEN = 'a'.repeat(32);

test('a share link is built from a token, never from an id', () => {
  assert.equal(spaceShareUrl(TOKEN), `https://holupp.net/s/${TOKEN}`);
  // An id is exactly what a shared Space link must not contain: ids are
  // sequential, so /s/41 would be a walkable member directory.
  assert.throws(() => spaceShareUrl('41'));
  assert.throws(() => spaceShareUrl(''));
  assert.throws(() => spaceShareUrl(TOKEN.slice(0, 31)));
  assert.equal(spaceShareUrl(TOKEN.toUpperCase()), `https://holupp.net/s/${TOKEN}`);
});

test('an id from an old link still opens the Space', () => {
  assert.equal(sharedSpaceId('https://holupp.net/?space=42'), 42);
  assert.equal(sharedSpaceId('http://localhost:8081/?space=7'), 7);
});

test('the app scheme opens a Space directly', () => {
  assert.equal(sharedSpaceId('holup://space/42'), 42);
  assert.equal(sharedSpaceId('crushly://space/42'), 42);
  assert.equal(sharedSpaceId('holup://space/0'), null);
  assert.equal(sharedSpaceId('holup://v/42'), null);
});

test('a token is not an id, and every wrong shape is refused', () => {
  assert.equal(sharedSpaceId(`https://holupp.net/s/${TOKEN}`), null);
  assert.equal(sharedSpaceId('https://evil.example/?space=42'), null);
  assert.equal(sharedSpaceId('https://holupp.net/?space=0'), null);
  assert.equal(sharedSpaceId('https://holupp.net/?space=1foo'), null);
  assert.equal(sharedSpaceId('not a url'), null);
  assert.equal(sharedSpaceId(null), null);
});
