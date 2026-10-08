import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawPosePair, isCompleteOtp, passwordStrength, sanitizeOtp } from './auth';

test('sanitizeOtp keeps digits only and caps at 6', () => {
  assert.equal(sanitizeOtp(''), '');
  assert.equal(sanitizeOtp('123456'), '123456');
  assert.equal(sanitizeOtp('1234567'), '123456');
  assert.equal(sanitizeOtp('12 34 56'), '123456');
  assert.equal(sanitizeOtp('1a2b3c4d5e6f'), '123456');
  assert.equal(sanitizeOtp('abcdef'), '');
  assert.equal(sanitizeOtp('0'), '0');
});

test('isCompleteOtp only accepts a full 6 digits', () => {
  assert.equal(isCompleteOtp('123456'), true);
  assert.equal(isCompleteOtp('12345'), false);
  assert.equal(isCompleteOtp('1234567'), true); // sanitized to 6 first
  assert.equal(isCompleteOtp(''), false);
  assert.equal(isCompleteOtp('12a456'), false); // letters stripped leaves 5 digits
  assert.equal(isCompleteOtp('1a2b3c456'), true); // letters stripped, 6 digits remain
});

test('passwordStrength buckets', () => {
  assert.equal(passwordStrength(''), null);
  assert.equal(passwordStrength('1234567'), 'Too short');
  assert.equal(passwordStrength('12345678'), 'Good');
  assert.equal(passwordStrength('abcdefgh'), 'Good');
  assert.equal(passwordStrength('abcd1234'), 'Good'); // mixed but under 10 chars
  assert.equal(passwordStrength('abcd12345'), 'Good'); // mixed, 9 chars — still under 10
  assert.equal(passwordStrength('abcd123456'), 'Strong'); // mixed + 10 chars
  assert.equal(passwordStrength('1234567890'), 'Good'); // digits only, no letters
});

test('drawPosePair returns two distinct poses', () => {
  const lib = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'] as const;
  for (let i = 0; i < 200; i++) {
    const [a, b] = drawPosePair(lib);
    assert.notEqual(a, b);
    assert.ok(lib.includes(a));
    assert.ok(lib.includes(b));
  }
});

test('drawPosePair is deterministic with an injected rand and never repeats', () => {
  const lib = ['x', 'y'] as const;
  // First draw index 0, second draw collides (0), retry picks 1.
  const rolls = [0.0, 0.0, 0.0];
  const [a, b] = drawPosePair(lib, () => rolls.shift() ?? 0);
  assert.equal(a, 'x');
  assert.equal(b, 'y');
});

test('drawPosePair works for a pair and rejects a single pose', () => {
  assert.deepEqual(drawPosePair(['only', 'two'], () => 0.99), ['two', 'only']);
  assert.throws(() => drawPosePair(['solo']), /at least 2/);
});
