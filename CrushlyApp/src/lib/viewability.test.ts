import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeIdAt, FOCUS_LINE, type CardBox } from './viewability';

const boxes: CardBox[] = [
  { id: 101, y: 0, height: 600 },
  { id: 102, y: 600, height: 600 },
  { id: 103, y: 1200, height: 600 },
];

test('no cards means nothing is active', () => {
  assert.equal(activeIdAt([], 0, 800), null);
});

test('at the top of the feed the first card is active', () => {
  assert.equal(activeIdAt(boxes, 0, 800), 101);
});

test('scrolling one card down moves the focus to the second card', () => {
  assert.equal(activeIdAt(boxes, 600, 800), 102);
});

test('the focus line sits above centre, not at the top of the viewport', () => {
  assert.equal(FOCUS_LINE, 0.45);
  // 300px of scroll with an 800px viewport puts the line at 660 — inside card 2.
  assert.equal(activeIdAt(boxes, 300, 800), 102);
});

test('the same scroll with the line at the top would choose differently', () => {
  // Proves the focus line is doing work: at focusLine 0 the line is at 300.
  assert.equal(activeIdAt(boxes, 300, 800, 0), 101);
});

test('a line landing in a gap picks the nearest card', () => {
  const gapped: CardBox[] = [
    { id: 1, y: 0, height: 100 },
    { id: 2, y: 400, height: 100 },
  ];
  // line = 0 + 800*0.45 = 360 → gap between 100 and 400 → nearest is card 1 (60 away) vs card 2 (40).
  assert.equal(activeIdAt(gapped, 0, 800), 2);
});

test('a line above every card picks the first', () => {
  const below: CardBox[] = [{ id: 7, y: 500, height: 300 }];
  assert.equal(activeIdAt(below, 0, 800), 7);
});

test('a line below every card picks the last', () => {
  const above: CardBox[] = [{ id: 7, y: 0, height: 100 }];
  assert.equal(activeIdAt(above, 0, 800), 7);
});

test('card boundaries belong to the card that starts there', () => {
  assert.equal(activeIdAt(boxes, 600 - 800 * FOCUS_LINE, 800), 102);
});
