import assert from 'node:assert/strict';
import test from 'node:test';
import { CACHE_LIMIT_BYTES, cacheName } from './videoCache';

test('two different clips never share a cache file', () => {
  const a = cacheName('https://crushly-media.example/m/posts/3/aaa.mp4');
  const b = cacheName('https://crushly-media.example/m/posts/3/bbb.mp4');
  assert.notEqual(a, b);
});

test('the same clip keeps the same name across launches', () => {
  const url = 'https://crushly-media.example/m/posts/3/1712345678-abcdef.mp4';
  assert.equal(cacheName(url), cacheName(url));
});

test('a token in the query string changes the name, so a new token re-fetches', () => {
  // Conservative on purpose: the token is part of the URL and the URL is the key.
  // A rotating token therefore costs one re-download rather than serving a file
  // the server has since stopped authorising for this member.
  const base = 'https://crushly-media.example/m/posts/3/clip.mp4';
  assert.notEqual(cacheName(`${base}?token=abc`), cacheName(base));
});

test('the name is a filesystem-safe extension the container agrees with', () => {
  assert.match(cacheName('https://x/y/CLIP.MOV'), /^[0-9a-z]+\.mov$/);
  assert.match(cacheName('https://x/y/no-extension'), /^[0-9a-z]+\.mp4$/);
  assert.match(cacheName('https://x/y/clip.webm?token=1'), /^[0-9a-z]+\.webm$/);
});

test('the cache has a ceiling, and it is not the whole disk', () => {
  assert.ok(CACHE_LIMIT_BYTES <= 1024 * 1024 * 1024);
  assert.ok(CACHE_LIMIT_BYTES >= 100 * 1024 * 1024);
});
