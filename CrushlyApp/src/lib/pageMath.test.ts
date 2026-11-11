import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOffPage, pageAt, stepIndex } from './pageMath';

const H = 844;

test('one gesture moves exactly one clip', () => {
  assert.equal(stepIndex(0, 1, 5), 1);
  assert.equal(stepIndex(3, -1, 5), 2);
});

test('the first clip cannot be scrolled above, the last cannot be scrolled past', () => {
  // The bug this exists to prevent: "next" at the end animated past the list and
  // bounced back, so a last clip replayed instead of holding still.
  assert.equal(stepIndex(0, -1, 5), 0);
  assert.equal(stepIndex(4, 1, 5), 4);
  assert.equal(stepIndex(4, -1, 1), 0);
});

test('a gesture that is neither forward nor back does nothing', () => {
  assert.equal(stepIndex(2, 0, 5), 2);
  assert.equal(stepIndex(2, Number.NaN, 5), 2);
});

test('an empty pager is page zero, never negative', () => {
  assert.equal(stepIndex(0, 1, 0), 0);
  assert.equal(pageAt(0, H, 0), 0);
});

test('a settled page is the nearest one, rounded rather than floored', () => {
  assert.equal(pageAt(0, H, 5), 0);
  assert.equal(pageAt(H, H, 5), 1);
  // 60% of the way up: that clip has been read, so the settle goes forward.
  assert.equal(pageAt(H * 1.6, H, 5), 2);
  assert.equal(pageAt(H * 1.4, H, 5), 1);
});

test('an over-scroll still reports a real page', () => {
  // Elastic overscroll on a phone reports a negative or too-large offset.
  assert.equal(pageAt(-120, H, 5), 0);
  assert.equal(pageAt(H * 9, H, 5), 4);
  // …and it is never `-0`, which fails an equality check against 0.
  assert.ok(Object.is(pageAt(-120, H, 5), 0));
});

test('a zero-height viewport does not divide by zero', () => {
  assert.equal(pageAt(500, 0, 5), 0);
  assert.equal(isOffPage(500, 0), false);
});

test('two pixels of rounding are not a half-cut clip', () => {
  assert.equal(isOffPage(H * 2, H), false);
  assert.equal(isOffPage(H * 2 + 2, H), false);
  assert.equal(isOffPage(H * 2 + 40, H), true);
  assert.equal(isOffPage(H * 0.5, H), true);
});
