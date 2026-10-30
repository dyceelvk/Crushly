import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { playbackAction } from './playbackPolicy';
test('scrolling away pauses even a manually started clip', () => {
  assert.equal(playbackAction(true, 'playing', false, false), 'pause');
  assert.equal(playbackAction(false, null, true, false), 'play');
});
test('a deliberate pause and an ended clip do not auto-play', () => {
  assert.equal(playbackAction(false, 'paused', true, false), 'pause');
  assert.equal(playbackAction(false, null, true, true), 'none');
  assert.equal(playbackAction(false, null, false, false), 'none');
});
