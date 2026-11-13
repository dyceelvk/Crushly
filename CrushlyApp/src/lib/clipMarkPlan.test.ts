import assert from 'node:assert/strict';
import test from 'node:test';
import { MARK_LIMIT_BYTES, markFailureIsFatal, markProgressLabel, markedClipKey, planMark } from './clipMarkPlan';

/**
 * The rule being protected: the Save row exists the moment the post does. That
 * only holds if the phone marks the clip before upload, and only if the cases
 * where it cannot are named rather than silently skipped.
 */
test('a phone with an encoder marks the clip before upload', () => {
  assert.deepEqual(
    planMark({ platform: 'android', encoderAvailable: true, bytes: 20 * 1024 * 1024 }),
    { action: 'mark', endCard: true },
  );
});

test('the end card travels with the mark, never separately', () => {
  const plan = planMark({ platform: 'android', encoderAvailable: true, bytes: 1000 });
  assert.equal(plan.action, 'mark');
  assert.equal(plan.action === 'mark' && plan.endCard, true);
});

test('web never tries: there is no encoder in a browser', () => {
  assert.deepEqual(planMark({ platform: 'web', encoderAvailable: false, bytes: 1000 }), { action: 'skip', reason: 'web' });
});

test('a device with no H.264 encoder skips instead of failing', () => {
  assert.deepEqual(planMark({ platform: 'android', encoderAvailable: false, bytes: 1000 }), { action: 'skip', reason: 'no-encoder' });
});

test('a re-posted clip that already carries a mark is not marked twice', () => {
  assert.deepEqual(
    planMark({ platform: 'android', encoderAvailable: true, bytes: 1000, alreadyMarked: true }),
    { action: 'skip', reason: 'already-marked' },
  );
});

test('past the marking ceiling the scheduled job does it instead', () => {
  assert.deepEqual(
    planMark({ platform: 'android', encoderAvailable: true, bytes: MARK_LIMIT_BYTES + 1 }),
    { action: 'skip', reason: 'too-big' },
  );
  assert.equal(planMark({ platform: 'android', encoderAvailable: true, bytes: MARK_LIMIT_BYTES }).action, 'mark');
});

test('an unmeasurable file is still attempted', () => {
  assert.equal(planMark({ platform: 'android', encoderAvailable: true, bytes: null }).action, 'mark');
});

test('marking never blocks the post', () => {
  assert.equal(markFailureIsFatal(), false);
});

test('the progress line says what is happening, and never shows a percentage', () => {
  assert.match(markProgressLabel(null), /name to the clip/i);
  assert.match(markProgressLabel(0.5), /name to the clip/i);
  assert.match(markProgressLabel(1), /finishing/i);
  assert.ok(!/\d/.test(markProgressLabel(0.42)), 'no stray numbers in member-facing copy');
});

test('the marked key matches the job and the database, for every container', () => {
  assert.equal(markedClipKey('posts/41/1740000000.mp4'), 'posts/41/1740000000-marked.mp4');
  assert.equal(markedClipKey('posts/41/1740000000.webm'), 'posts/41/1740000000-marked.mp4');
  assert.equal(markedClipKey('posts/41/1740000000.mov'), 'posts/41/1740000000-marked.mp4');
  assert.equal(markedClipKey('/posts/41/1740000000.mp4'), 'posts/41/1740000000-marked.mp4');
  assert.equal(markedClipKey('posts/41/no-extension'), 'posts/41/no-extension-marked.mp4');
  assert.equal(markedClipKey(''), '');
});
