import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mediaCacheControl } from './cacheControl';

test('uncacheable private media is never stored by browsers or proxies', () => {
  for (const kind of ['photos', 'posts', 'moments', 'circles', 'messages', 'banners'])
    assert.equal(mediaCacheControl(`${kind}/1/file.jpg`, false), 'private, no-store');
});

test('banners and messages remain private even if a verdict is misconfigured', () => {
  for (const kind of ['banners', 'messages'])
    assert.equal(mediaCacheControl(`${kind}/1/file.jpg`, true), 'private, no-store');
});

test('explicitly cacheable media keeps its existing lifetime', () => {
  assert.equal(mediaCacheControl('moments/1/test.jpg', true), 'public, max-age=3600');
  assert.equal(mediaCacheControl('posts/1/test.jpg', true), 'public, max-age=604800');
});
