import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keyboardOverlap } from './keyboardOverlap';

test('an overlaid Android keyboard lifts the composer by its overlap', () => {
  assert.equal(keyboardOverlap(0, 640, 394), 246);
});
test('a root already resized above the keyboard is not shifted twice', () => {
  assert.equal(keyboardOverlap(24, 370, 394), 0);
});
test('invalid layout never moves content off screen', () => {
  assert.equal(keyboardOverlap(0, 0, 100), 0);
  assert.equal(keyboardOverlap(0, 600, Number.NaN), 0);
});
