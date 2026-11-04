import assert from 'node:assert/strict';
import test from 'node:test';
import { MOMENT_RING_COLORS, momentRing, momentRingColor } from './momentRings';

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
