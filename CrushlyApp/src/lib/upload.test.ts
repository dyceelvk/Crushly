import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extensionFor, uploadContentType } from './upload';

/**
 * A clip shared from the Flow went through extensionFor() and came out as an
 * audio file, so the server refused it as an unsupported type and the app
 * reported a row-policy failure on the post. These are the exact types a phone
 * hands over, asserted so the audio branch cannot swallow video again.
 */
test('a video is never filed as audio', () => {
  assert.equal(extensionFor('video/mp4'), 'mp4');
  assert.equal(extensionFor('video/webm'), 'webm');
  assert.equal(extensionFor('video/quicktime'), 'mov');
  assert.equal(extensionFor('VIDEO/MP4'), 'mp4');
});

test('audio keeps its own extensions', () => {
  assert.equal(extensionFor('audio/mp4'), 'm4a');
  assert.equal(extensionFor('audio/mpeg'), 'mp3');
  assert.equal(extensionFor('audio/aac'), 'm4a');
});

test('photos and the fallbacks are unchanged', () => {
  assert.equal(extensionFor('image/jpeg'), 'jpg');
  assert.equal(extensionFor('image/png'), 'png');
  assert.equal(extensionFor('image/heic'), 'heic');
  assert.equal(extensionFor(undefined), 'jpg');
  assert.equal(extensionFor('something/verylongsubtype'), 'jpg');
});

/**
 * The type sent to the server has to describe the file that will actually be
 * stored. A picker that reports quicktime while the path ends .mp4 must not
 * hand the Worker a container it will reject.
 */
test('the upload type follows the stored extension', () => {
  assert.equal(uploadContentType('video/quicktime', 'mp4'), 'video/mp4');
  assert.equal(uploadContentType('application/octet-stream', 'mp4'), 'video/mp4');
  assert.equal(uploadContentType('video/quicktime', 'webm'), 'video/webm');
  assert.equal(uploadContentType('audio/x-m4a', 'm4a'), 'audio/mp4');
  assert.equal(uploadContentType('image/jpeg', 'jpg'), 'image/jpeg');
  assert.equal(uploadContentType('', 'png'), 'image/png');
});
