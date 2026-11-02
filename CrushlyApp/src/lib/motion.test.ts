import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CROSSFADE,
  EASE_IN,
  EASE_OUT,
  DUR,
  STAGGER,
  STAGGER_CAP,
  TRAVEL,
  crossfadeDelays,
  duration,
  stagger,
  staggerTotal,
  tabInk,
} from './motion';

test('durations stay inside the measured class', () => {
  for (const ms of Object.values(DUR)) {
    assert.ok(ms >= 100 && ms <= 300, `${ms} is outside the 100–300 ms band both apps use`);
  }
});

test('leaving is never slower than arriving', () => {
  assert.ok(DUR.exit <= DUR.enter);
});

test('a stagger is capped, so a long list does not arrive one item at a time', () => {
  assert.equal(stagger(0), 0);
  assert.equal(stagger(2), 2 * STAGGER);
  assert.equal(stagger(STAGGER_CAP), STAGGER_CAP * STAGGER);
  assert.equal(stagger(99), STAGGER_CAP * STAGGER, 'past the cap the delay stops growing');
});

test('a whole list settles in a time worth waiting for', () => {
  assert.equal(staggerTotal(1), DUR.enter);
  assert.ok(staggerTotal(40) < 600, 'forty items must still settle quickly');
});

test('distances are small, and a label moves least', () => {
  assert.ok(TRAVEL.label < TRAVEL.card);
  assert.ok(TRAVEL.card < TRAVEL.panel);
  assert.equal(TRAVEL.label, 4, 'measured from the editor label-in keyframe');
  assert.equal(TRAVEL.panel, 56, 'measured from the panel translateX');
});

test('reduce motion collapses every duration to nothing', () => {
  assert.equal(duration(DUR.enter, true), 0);
  assert.equal(duration(DUR.enter, false), DUR.enter);
  assert.deepEqual(crossfadeDelays(true), { out: 0, in: 0 });
});

test('the crossfade holds a gap between out and in', () => {
  const d = crossfadeDelays(false);
  assert.equal(d.out, CROSSFADE.out);
  assert.equal(d.in, CROSSFADE.out + CROSSFADE.hold);
  assert.ok(d.in > d.out);
});

test('the curve actually decelerates, and is pinned at both ends', () => {
  assert.equal(EASE_OUT(0), 0);
  assert.equal(EASE_OUT(1), 1);
  // Decelerating: the first half of the time covers more than half the travel.
  assert.ok(EASE_OUT(0.5) > 0.5, `expected ease-out, got ${EASE_OUT(0.5)}`);
  let previous = -1;
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const v = EASE_OUT(t);
    assert.ok(v >= previous - 1e-6, 'the curve must never go backwards');
    previous = v;
  }
});

test('the entry curve starts gently', () => {
  assert.ok(EASE_IN(0.5) < 0.5, `expected ease-in, got ${EASE_IN(0.5)}`);
});

test('a tab state is colour only — the weight never changes', () => {
  assert.deepEqual(tabInk(true), { opacity: 1, weight: 500 });
  assert.deepEqual(tabInk(false), { opacity: 0.6, weight: 500 });
});
