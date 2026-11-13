import assert from 'node:assert/strict';
import test from 'node:test';
import { HOLD_SPEED, speedWhile, HOLD_SPEED_DELAY_MS, boostWhileHeld } from './holdSpeed';

test('holding plays at double, letting go returns to the clip own speed', () => {
  assert.equal(speedWhile({ holding: true, base: 1 }), HOLD_SPEED);
  assert.equal(speedWhile({ holding: false, base: 1 }), 1);
});

test('a slow-motion clip is returned to slow motion, not to 1x', () => {
  assert.equal(speedWhile({ holding: true, base: 0.5 }), 1);
  assert.equal(speedWhile({ holding: false, base: 0.5 }), 0.5);
});

test('a nonsense speed is treated as normal rather than producing NaN', () => {
  for (const base of [null, undefined, 0, -2, Number.NaN]) {
    assert.equal(speedWhile({ holding: false, base }), 1);
    assert.equal(speedWhile({ holding: true, base }), HOLD_SPEED);
  }
});

test('the boost is clamped so a fast clip cannot run away', () => {
  assert.equal(speedWhile({ holding: true, base: 4 }), 8);
});

/**
 * A tap is not a hold.
 *
 * The feed reported that touching mute, comment, crush or share fast-forwarded
 * the clip instead. The strip answered on press-in, so any touch on the right of
 * the picture boosted — and it was drawn over the mute button. These pin the
 * delay half of the fix; the layering half is in EditedClip.
 */
test('a touch that is only a tap never changes the speed', () => {
  assert.equal(boostWhileHeld(0), false);
  assert.equal(boostWhileHeld(80), false);
  assert.equal(boostWhileHeld(HOLD_SPEED_DELAY_MS - 1), false);
});

test('a real hold does', () => {
  assert.equal(boostWhileHeld(HOLD_SPEED_DELAY_MS), true);
  assert.equal(boostWhileHeld(900), true);
});
