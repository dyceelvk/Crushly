import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampOverlays,
  cutTimeAt,
  durationOf,
  duplicateSegment,
  followCuts,
  locate,
  moveSegment,
  removeSegment,
  singleSegment,
  snap,
  sourceAt,
  splitAt,
  trimSegment,
} from './timeline';

const s = (id: string, start: number, end: number) => ({ id, start, end });

test('an uncut edit is one window, and the two clocks agree', () => {
  const segs = singleSegment(2, 12);
  assert.equal(durationOf(segs), 10);
  assert.equal(sourceAt(segs, 0), 2);
  assert.equal(sourceAt(segs, 10), 12);
  assert.equal(cutTimeAt(segs, 7), 5);
});

test('splitting keeps every frame and loses none', () => {
  const segs = singleSegment(0, 10);
  const cut = splitAt(segs, 4);
  assert.equal(cut.length, 2);
  assert.equal(durationOf(cut), 10);
  assert.deepEqual(cut.map((x) => [x.start, x.end]), [[0, 4], [4, 10]]);
});

test('splitting on a boundary is not a cut', () => {
  const segs = singleSegment(0, 10);
  const once = splitAt(segs, 4);
  assert.equal(splitAt(once, 4), once, 'a second cut at the same place changes nothing');
  assert.equal(splitAt(segs, 0), segs);
});

test('removing the middle leaves the ends joined, and the clock shortens', () => {
  let segs = singleSegment(0, 12);
  segs = splitAt(segs, 4);
  segs = splitAt(segs, 8);
  assert.equal(segs.length, 3);
  const kept = removeSegment(segs, segs[1].id);
  assert.equal(kept.length, 2);
  assert.equal(durationOf(kept), 8);
  // Cut second 4 is now source second 8: the gap is gone.
  assert.equal(sourceAt(kept, 4), 8);
});

test('the last piece cannot be removed', () => {
  const segs = singleSegment(0, 10);
  assert.equal(removeSegment(segs, segs[0].id).length, 1);
});

test('trimming one piece cannot swallow its neighbour', () => {
  let segs = singleSegment(0, 10);
  segs = splitAt(segs, 5);
  const trimmed = trimSegment(segs, segs[1].id, 9.95, 10);
  // Float: 10 - 9.8 is 0.1999999999999993, so compare with a hair of slack.
  assert.ok(trimmed[1].end - trimmed[1].start >= 0.2 - 1e-9);
});

test('trims below zero are pushed up, not allowed', () => {
  const segs = singleSegment(0, 10);
  const t = trimSegment(segs, segs[0].id, -3, 6);
  assert.equal(t[0].start, 0);
});

test('duplicating and reordering move pieces, not frames', () => {
  let segs = singleSegment(0, 10);
  segs = splitAt(segs, 5);
  const dup = duplicateSegment(segs, segs[0].id);
  assert.equal(dup.length, 3);
  assert.equal(durationOf(dup), 15);
  const moved = moveSegment(dup, dup[2].id, -1);
  assert.equal(moved[1].id, dup[2].id);
});

test('locate reports which piece the playhead is in', () => {
  let segs = singleSegment(0, 10);
  segs = splitAt(segs, 4);
  const at = locate(segs, 6);
  assert.equal(at?.index, 1);
  assert.equal(at?.into, 2);
});

test('a frame that was cut away has no cut time', () => {
  const kept = [s('a', 0, 4), s('b', 8, 12)];
  assert.equal(cutTimeAt(kept, 6), null);
  assert.equal(cutTimeAt(kept, 9), 5);
});

test('snapping lands on an edge when one is near, and stays put when not', () => {
  const targets = [0, 4, 10];
  assert.equal(snap(4.06, targets, 0.1), 4);
  assert.equal(snap(6, targets, 0.1), 6);
});

test('overlays are pulled inside a sequence that got shorter', () => {
  const out = clampOverlays([{ id: 'c', start: 7, end: 9 }], 5);
  assert.ok(out[0].start <= 5);
  assert.ok(out[0].end <= 5);
  assert.ok(out[0].end - out[0].start >= 0.2 - 1e-9);
});

test('playback of a clip whose cut travels as data skips what was cut away', () => {
  const cuts = [s('a', 0, 4), s('b', 8, 12)];

  // Inside the first piece: the clip time is the file time.
  assert.deepEqual(followCuts(cuts, 2.5, true), { cut: 2.5, seekTo: null, ended: false });

  // Inside the hole: jump to the start of the next piece, and report the clip
  // time where that piece begins — not zero, which would replay the first piece.
  assert.deepEqual(followCuts(cuts, 6, true), { cut: 4, seekTo: 8, ended: false });

  // Inside the second piece: clip time is offset by the four seconds kept.
  assert.equal(followCuts(cuts, 9, true).cut, 5);

  // The end: loop back to the first frame, or stop and say so.
  assert.deepEqual(followCuts(cuts, 11.99, true), { cut: 0, seekTo: 0, ended: false });
  assert.deepEqual(followCuts(cuts, 11.99, false), { cut: 8, seekTo: null, ended: true });
});

test('the end of the whole file is not inside a piece', () => {
  const cuts = [s('a', 2, 6), s('b', 10, 14)];
  const after = followCuts(cuts, 20, false);
  assert.equal(after.ended, true);
  assert.equal(after.cut, 8);
  assert.equal(after.seekTo, null);
});
