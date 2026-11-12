import assert from 'node:assert/strict';
import test from 'node:test';
import { HOLD_SPEED, speedWhile } from './holdSpeed';

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
