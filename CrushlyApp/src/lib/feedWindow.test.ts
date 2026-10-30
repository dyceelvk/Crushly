import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedWindow, isMounted, isAudible, FEED_WINDOW_RADIUS } from './feedWindow';

test('an empty feed has no window and no active post', () => {
  const win = feedWindow(0, 0);
  assert.equal(win.active, null);
  assert.equal(win.end, -1);
  assert.equal(isAudible(win, 0), false);
});

test('the middle of a feed mounts three posts around the active one', () => {
  const win = feedWindow(12, 5);
  assert.deepEqual({ start: win.start, end: win.end, active: win.active }, { start: 4, end: 6, active: 5 });
  assert.equal(isMounted(win, 4), true);
  assert.equal(isMounted(win, 5), true);
  assert.equal(isMounted(win, 6), true);
  assert.equal(isMounted(win, 3), false);
  assert.equal(isMounted(win, 7), false);
});

test('exactly one post is audible, and it is the active one', () => {
  const win = feedWindow(12, 5);
  const audible = Array.from({ length: 12 }, (_, i) => i).filter((i) => isAudible(win, i));
  assert.deepEqual(audible, [5]);
});

test('a mounted neighbour is preloaded but never audible', () => {
  const win = feedWindow(12, 5);
  assert.equal(isMounted(win, 4), true);
  assert.equal(isAudible(win, 4), false);
});

test('the window clamps at the start of the feed without going negative', () => {
  const win = feedWindow(12, 0);
  assert.equal(win.start, 0);
  assert.equal(win.end, 1);
  assert.equal(win.active, 0);
});

test('the window clamps at the end of the feed without running past it', () => {
  const win = feedWindow(12, 11);
  assert.equal(win.start, 10);
  assert.equal(win.end, 11);
  assert.equal(win.active, 11);
});

test('an out-of-range active index is clamped rather than trusted', () => {
  assert.equal(feedWindow(5, 99).active, 4);
  assert.equal(feedWindow(5, -3).active, 0);
});

test('a feed shorter than the window is entirely mounted', () => {
  const win = feedWindow(2, 0);
  assert.equal(win.start, 0);
  assert.equal(win.end, 1);
});

test('a single-post feed mounts and plays exactly that post', () => {
  const win = feedWindow(1, 0);
  assert.equal(win.start, 0);
  assert.equal(win.end, 0);
  assert.equal(isAudible(win, 0), true);
});

test('a radius of zero mounts only the active post', () => {
  const win = feedWindow(12, 5, 0);
  assert.equal(win.start, 5);
  assert.equal(win.end, 5);
});

test('a larger radius widens the window symmetrically', () => {
  const win = feedWindow(20, 10, 3);
  assert.equal(win.start, 7);
  assert.equal(win.end, 13);
});

test('a negative radius is treated as zero rather than inverting the window', () => {
  const win = feedWindow(12, 5, -4);
  assert.equal(win.start, 5);
  assert.equal(win.end, 5);
});

test('the default radius is one either side', () => {
  assert.equal(FEED_WINDOW_RADIUS, 1);
});
