import { test } from 'node:test';
import assert from 'node:assert/strict';

import { aspectRatioOf, clampRatio, frameHeight, leavesBands, stageFit, videoFrame, videoRatio } from './videoFrame';

test('videoRatio reads a real size and refuses nonsense', () => {
  assert.equal(videoRatio({ width: 1280, height: 720 }), 16 / 9);
  assert.equal(videoRatio({ width: 720, height: 1280 }), 9 / 16);
  assert.equal(videoRatio({ width: 1000, height: 1000 }), 1);
  // Every shape of "no answer yet" has to come back null, not NaN or Infinity.
  assert.equal(videoRatio(null), null);
  assert.equal(videoRatio({}), null);
  assert.equal(videoRatio({ width: 0, height: 720 }), null);
  assert.equal(videoRatio({ width: 1280, height: 0 }), null);
  assert.equal(videoRatio({ width: -1280, height: 720 }), null);
  assert.equal(videoRatio({ width: Number.NaN, height: 720 }), null);
});

test('aspectRatioOf maps a choice, and a bad choice falls back to the source', () => {
  assert.equal(aspectRatioOf('original'), null);
  assert.equal(aspectRatioOf('9:16'), 9 / 16);
  assert.equal(aspectRatioOf('4:5'), 4 / 5);
  assert.equal(aspectRatioOf('1:1'), 1);
  assert.equal(aspectRatioOf('16:9'), 16 / 9);
  assert.equal(aspectRatioOf(undefined), null);
  assert.equal(aspectRatioOf('nonsense'), null);
});

test('an unedited video is framed by its own shape and is never cropped', () => {
  // The bug: landscape 16:9 in a 4:5 slot either crops the sides or floats.
  const land = videoFrame({ measured: 16 / 9, aspect: 'original' });
  assert.equal(land.crops, false);
  assert.equal(land.fit, 'contain');
  assert.equal(land.ratio, 16 / 9);

  const port = videoFrame({ measured: 9 / 16, aspect: 'original' });
  assert.equal(port.crops, false);
  assert.equal(port.ratio, 9 / 16);
});

test('a chosen shape is honoured and the crop is declared', () => {
  const square = videoFrame({ measured: 9 / 16, aspect: '1:1' });
  assert.equal(square.crops, true);
  assert.equal(square.fit, 'cover');
  assert.equal(square.ratio, 1);

  // Even when the source is unknown, the choice is enough to frame it.
  const chosenOnly = videoFrame({ measured: null, aspect: '16:9' });
  assert.equal(chosenOnly.ratio, 16 / 9);
  assert.equal(chosenOnly.crops, true);
});

test('before the source reports a size the frame is held open, not collapsed', () => {
  const pending = videoFrame({ measured: null, aspect: 'original' });
  assert.equal(pending.ratio, 4 / 5);
  assert.equal(pending.crops, false);

  const custom = videoFrame({ measured: null, aspect: 'original', fallback: 9 / 16 });
  assert.equal(custom.ratio, 9 / 16);

  // A zero or negative measurement is "not yet", not a zero-height box.
  assert.equal(videoFrame({ measured: 0, aspect: 'original', fallback: 1 }).ratio, 1);
});

test('clampRatio keeps a corrupt value from owning the screen', () => {
  assert.equal(clampRatio(1), 1);
  assert.equal(clampRatio(0.02), 0.3);
  assert.equal(clampRatio(40), 3);
  assert.equal(clampRatio(null), null);
  assert.equal(clampRatio(Number.NaN), null);
  assert.equal(clampRatio(0), null);
  // A 1×5000 stream becomes a tall-but-possible frame instead of a sliver.
  assert.equal(videoFrame({ measured: videoRatio({ width: 1, height: 5000 }) }).ratio, 0.3);
});

test('frameHeight caps a tall clip so it cannot own the viewport', () => {
  assert.equal(frameHeight(1, 400), 400);
  assert.equal(frameHeight(0.5, 400), 800);
  assert.equal(frameHeight(0.5, 400, 520), 520);
  assert.equal(frameHeight(2, 400, 520), 200);
  // Degenerate ratio must not divide by zero.
  assert.equal(frameHeight(0, 400), 40000);
});

test('a stage shows the whole frame, and fills the space with the clip itself', () => {
  // Default: nothing cropped, and the letterbox is not black.
  assert.deepEqual(stageFit(undefined), { contentFit: 'contain', backdrop: true });
  assert.deepEqual(stageFit('fit'), { contentFit: 'contain', backdrop: true });
  // Chosen: no letterbox at all, so nothing to draw behind it.
  assert.deepEqual(stageFit('fill'), { contentFit: 'cover', backdrop: false });
});

test('leavesBands only says yes when there is actually a band to fill', () => {
  // A 16:9 clip on a 9:19.5 phone stage: yes, a great deal of it.
  assert.equal(leavesBands(9 / 19.5, 16 / 9), true);
  // A portrait clip on a portrait stage: nearly, but not quite, the same box.
  assert.equal(leavesBands(9 / 19.5, 9 / 19.5), false);
  // Within a couple of percent is a crop no one would see, and not worth a
  // second decoder.
  assert.equal(leavesBands(0.5, 0.51), false);
  // Unmeasurable is not a reason to draw anything extra.
  assert.equal(leavesBands(null, 16 / 9), false);
  assert.equal(leavesBands(0.5, null), false);
  assert.equal(leavesBands(0, 0.5), false);
  assert.equal(leavesBands(Number.NaN, 0.5), false);
});
