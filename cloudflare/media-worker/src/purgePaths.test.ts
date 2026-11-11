import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cleanPurgePaths } from './purgePaths';

test('keeps the keys this app actually mints', () => {
  assert.deepEqual(
    cleanPurgePaths(['posts/3/1794438246364-9c26be02d4.mp4', 'moments/9/a.jpg', 'messages/41/v.m4a']),
    ['posts/3/1794438246364-9c26be02d4.mp4', 'moments/9/a.jpg', 'messages/41/v.m4a'],
  );
});

test('refuses anything outside the six kind folders', () => {
  assert.deepEqual(cleanPurgePaths(['android-releases/Crushly.apk', 'etc/passwd', 'a/b/c']), []);
});

test('refuses a path that climbs out of its folder', () => {
  assert.deepEqual(cleanPurgePaths(['posts/3/../../../secrets', 'posts/../x.jpg']), []);
});

test('trims the leading slash and the whitespace, and drops duplicates', () => {
  assert.deepEqual(cleanPurgePaths([' /posts/3/a.jpg ', 'posts/3/a.jpg']), ['posts/3/a.jpg']);
});

test('a body that is not a list, or holds junk, deletes nothing rather than throwing', () => {
  assert.deepEqual(cleanPurgePaths(null), []);
  assert.deepEqual(cleanPurgePaths({ paths: ['posts/3/a.jpg'] }), []);
  assert.deepEqual(cleanPurgePaths([1, null, {}, '', '/']), []);
});

test('a path long enough to be an attack is dropped, not truncated', () => {
  assert.deepEqual(cleanPurgePaths([`posts/3/${'a'.repeat(500)}`]), []);
});
