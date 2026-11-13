import assert from 'node:assert/strict';
import test from 'node:test';
import { MARK_LIMIT_BYTES } from './clipMarkPlan';
import { clipToMarkBytes, markedCopyFitsUpload, planClipPost } from './clipPostPlan';

const MB = 1024 * 1024;
const UPLOAD_MAX = 120 * MB;

/**
 * The report being protected against: the Android APK force-closed while
 * compressing an uploaded video. The cause was three transcodes in a row, the
 * second and third of them on the original 200 MB pick. So the tests here are
 * about which file is handed to the mark, not about whether marking happens.
 */

test('a big pick is marked from the compressed copy, never from the original', () => {
  const plan = planClipPost({
    platform: 'android',
    encoderAvailable: true,
    pickedBytes: 200 * MB,
    preparedBytes: 40 * MB,
  });
  assert.equal(plan.markFrom, 'prepared');
  assert.equal(plan.markFrom === 'prepared' && plan.bytes, 40 * MB);
  // The regression, stated as a number: the mark is never given the 200 MB pick.
  assert.notEqual(plan.markFrom === 'prepared' && plan.bytes, 200 * MB);
});

test('the bytes handed over are the prepared size, not the picked size', () => {
  assert.equal(clipToMarkBytes({ platform: 'android', encoderAvailable: true, pickedBytes: 210 * MB, preparedBytes: 58 * MB }), 58 * MB);
});

test('a clip small enough to skip compressing is marked as it is', () => {
  // No compression happened, so the prepared copy *is* the pick: 9 MB.
  const plan = planClipPost({ platform: 'android', encoderAvailable: true, pickedBytes: 9 * MB, preparedBytes: 9 * MB });
  assert.equal(plan.markFrom, 'prepared');
  assert.equal(plan.markFrom === 'prepared' && plan.bytes, 9 * MB);
});

test('unmeasured size falls back to the pick, which is the file that was uploaded', () => {
  assert.equal(clipToMarkBytes({ platform: 'android', encoderAvailable: true, pickedBytes: 6 * MB, preparedBytes: null }), 6 * MB);
});

test('a marked copy past the mark ceiling is still skipped', () => {
  // Can only happen if the encoder overshot the 64 MB target wildly; the mark
  // ceiling is the last guard before a second heavy transcode.
  const plan = planClipPost({
    platform: 'android',
    encoderAvailable: true,
    pickedBytes: 200 * MB,
    preparedBytes: MARK_LIMIT_BYTES + 1,
  });
  assert.deepEqual(plan, { markFrom: 'none', reason: 'too-big' });
});

test('the web has nothing to mark with', () => {
  assert.deepEqual(
    planClipPost({ platform: 'web', encoderAvailable: false, pickedBytes: 200 * MB, preparedBytes: null }),
    { markFrom: 'none', reason: 'web' },
  );
});

test('a phone with no encoder skips marking instead of trying', () => {
  assert.deepEqual(
    planClipPost({ platform: 'android', encoderAvailable: false, pickedBytes: 50 * MB, preparedBytes: 30 * MB }),
    { markFrom: 'none', reason: 'no-encoder' },
  );
});

test('a re-post of an already-marked clip is not marked again', () => {
  assert.deepEqual(
    planClipPost({ platform: 'android', encoderAvailable: true, pickedBytes: 50 * MB, preparedBytes: 30 * MB, alreadyMarked: true }),
    { markFrom: 'none', reason: 'already-marked' },
  );
});

test('a marked copy that fits the upload ceiling goes up without another transcode', () => {
  assert.equal(markedCopyFitsUpload(58 * MB, UPLOAD_MAX), true);
  assert.equal(markedCopyFitsUpload(UPLOAD_MAX, UPLOAD_MAX), true);
  // An encoder that overshot, and a file nobody could measure: both take the
  // normal compressing path rather than being trusted blindly.
  assert.equal(markedCopyFitsUpload(UPLOAD_MAX + 1, UPLOAD_MAX), false);
  assert.equal(markedCopyFitsUpload(null, UPLOAD_MAX), false);
  assert.equal(markedCopyFitsUpload(0, UPLOAD_MAX), false);
});
