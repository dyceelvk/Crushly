import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleDwell, openSpan, MIN_REPORTABLE_MS, CONSIDERED_MS } from './dwell';

test('arriving on a post opens a span; leaving it settles one', () => {
  const span = openSpan(7, 1_000, 0);
  assert.deepEqual(span, { postId: 7, sinceMs: 1_000, position: 0 });

  const settled = settleDwell(span, 8, 1_000 + 4_200);
  assert.equal(settled?.postId, 7);
  assert.equal(settled?.ms, 4_200);
  assert.equal(settled?.completed, true, 'four seconds is a watch, not a skip');
  assert.equal(settled?.position, 0);
});

test('a scroll past is not a read and is not reported', () => {
  const span = openSpan(3, 0);
  const settled = settleDwell(span, 4, MIN_REPORTABLE_MS - 1);
  assert.equal(settled, null);
});

test('re-measuring the same post does not settle it', () => {
  const span = openSpan(3, 0);
  assert.equal(settleDwell(span, 3, 9_000), null);
});

test('moving to no post keeps the span open — an interruption is not a skip', () => {
  const span = openSpan(3, 0);
  assert.equal(settleDwell(span, null, 9_000), null);
});

test('a clip that plays to the end is complete even if held briefly', () => {
  const span = openSpan(11, 0);
  const settled = settleDwell(span, 12, MIN_REPORTABLE_MS + 1, true);
  assert.equal(settled?.completed, true);
  assert.equal(settled?.ms, MIN_REPORTABLE_MS + 1);
});

test('the threshold between a glance and a watch is the one we document', () => {
  const span = openSpan(1, 0);
  assert.equal(settleDwell(span, 2, CONSIDERED_MS - 1)?.completed, false);
  assert.equal(settleDwell(span, 2, CONSIDERED_MS)?.completed, true);
});

test('an absurd clock cannot report an absurd dwell', () => {
  const span = openSpan(1, 0);
  assert.equal(settleDwell(span, 2, 10 * 3_600_000)?.ms, 3_600_000);
  // A clock that went backwards produces no span at all, not a negative one.
  assert.equal(settleDwell(openSpan(1, 5_000), 2, 1_000), null);
});

test('no post ever opened means nothing to report', () => {
  assert.equal(settleDwell(null, 5, 1_000), null);
  assert.equal(openSpan(null, 0), null);
});
