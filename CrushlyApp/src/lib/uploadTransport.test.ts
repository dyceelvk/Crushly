import assert from 'node:assert/strict';
import test from 'node:test';
import { BLOB_SAFE_BYTES, blobFallbackIsSafe, uploadTransport } from './uploadTransport';

const MB = 1024 * 1024;

/**
 * The bug these protect: on 1.0.109 the compressor finished, the spinner said
 * "Uploading", and the app closed a few seconds later. The upload was reading a
 * 60–96 MB file into a Blob and then sending it, so the clip existed twice in
 * memory. A phone-owned file must be streamed from disk instead.
 */

test('a phone-owned file is streamed from disk, never read into a Blob', () => {
  assert.equal(uploadTransport('android', 'file:///data/user/0/app.crushly/cache/holupp-compressed/1.mp4', true), 'disk-stream');
  assert.equal(uploadTransport('ios', 'file:///var/mobile/tmp/clip.mov', true), 'disk-stream');
});

test('a content uri is streamed too, because it is copied to the cache first', () => {
  assert.equal(uploadTransport('android', 'content://media/external/video/media/42', true), 'disk-stream');
});

test('the web has no file to point at', () => {
  assert.equal(uploadTransport('web', 'blob:https://www.holupp.net/1234', true), 'blob');
});

test('a build without the upload module still uploads', () => {
  // Degrades to the old path rather than failing the post.
  assert.equal(uploadTransport('android', 'file:///tmp/clip.mp4', false), 'blob');
});

test('a remote uri is not a local file', () => {
  assert.equal(uploadTransport('android', 'https://example.test/a.mp4', true), 'blob');
});

test('the Blob fallback is only taken for files that fit in memory comfortably', () => {
  assert.equal(blobFallbackIsSafe(4 * MB), true);
  assert.equal(blobFallbackIsSafe(BLOB_SAFE_BYTES), true);
  assert.equal(blobFallbackIsSafe(BLOB_SAFE_BYTES + 1), false);
  // An unmeasured file could be anything, so it is not worth risking a kill.
  assert.equal(blobFallbackIsSafe(null), false);
  assert.equal(blobFallbackIsSafe(0), false);
});
