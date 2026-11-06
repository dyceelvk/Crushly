import assert from 'node:assert/strict';
import test from 'node:test';
import { MOMENT_RING_COLORS, MOMENT_RING_SEEN, momentRing, momentRingColor, momentRingState } from './momentRings';

test('a member always wears the same ring', () => {
  for (const id of [1, 2, 7, 42, 9999]) {
    assert.equal(momentRingColor(id), momentRingColor(id));
  }
});

test('the ring is one of the palette, never a made-up colour', () => {
  for (let id = 0; id < 50; id += 1) {
    assert.ok((MOMENT_RING_COLORS as readonly string[]).includes(momentRingColor(id)));
  }
});

test('a negative or broken id still gets a real colour', () => {
  assert.ok((MOMENT_RING_COLORS as readonly string[]).includes(momentRingColor(-3)));
  assert.ok((MOMENT_RING_COLORS as readonly string[]).includes(momentRingColor(Number.NaN)));
});

test('nothing live means no ring, not a default one', () => {
  assert.equal(momentRing(5, false), null);
  assert.equal(momentRing(5, true), momentRingColor(5));
});

test('a live Moment nobody has watched wears the member’s own colour', () => {
  assert.equal(momentRingState(7, true, false), momentRingColor(7));
});

test('a watched Moment keeps a quiet ring — it is not the same as having none', () => {
  assert.equal(momentRingState(7, true, true), MOMENT_RING_SEEN);
  assert.notEqual(MOMENT_RING_SEEN, momentRingColor(7));
  assert.ok(MOMENT_RING_SEEN !== null);
});

test('nothing live is no ring, watched or not', () => {
  assert.equal(momentRingState(7, false, false), null);
  assert.equal(momentRingState(7, false, true), null);
});
