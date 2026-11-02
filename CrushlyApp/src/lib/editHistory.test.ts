import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HISTORY_LIMIT,
  canRedo,
  canUndo,
  depth,
  record,
  redo,
  replace,
  startHistory,
  undo,
} from './editHistory';

test('a fresh history can neither undo nor redo', () => {
  const h = startHistory('a');
  assert.equal(canUndo(h), false);
  assert.equal(canRedo(h), false);
});

test('one edit, one step back', () => {
  let h = startHistory('a');
  h = record(h, 'b');
  assert.equal(h.present, 'b');
  assert.equal(canUndo(h), true);
  h = undo(h);
  assert.equal(h.present, 'a');
  assert.equal(canRedo(h), true);
  h = redo(h);
  assert.equal(h.present, 'b');
});

test('a drag folds into a single step', () => {
  let h = startHistory(0);
  for (let i = 1; i <= 20; i++) h = record(h, i, 'trim');
  assert.deepEqual(depth(h), { undo: 1, redo: 0 });
  h = undo(h);
  assert.equal(h.present, 0);
});

test('a new gesture starts a new step', () => {
  let h = startHistory(0);
  h = record(h, 1, 'trim');
  h = record(h, 2, 'trim');
  h = record(h, 3, 'speed');
  h = record(h, 4, 'speed');
  assert.deepEqual(depth(h), { undo: 2, redo: 0 });
});

test('a discrete action is never folded, even twice in a row', () => {
  let h = startHistory(0);
  h = record(h, 1);
  h = record(h, 2);
  assert.deepEqual(depth(h), { undo: 2, redo: 0 });
});

test('editing after undoing throws the redo branch away', () => {
  let h = startHistory('a');
  h = record(h, 'b');
  h = undo(h);
  h = record(h, 'c');
  assert.equal(h.present, 'c');
  assert.equal(canRedo(h), false);
});

test('history is bounded, and the oldest step is the one that goes', () => {
  let h = startHistory(0);
  for (let i = 1; i <= HISTORY_LIMIT + 10; i++) h = record(h, i);
  assert.equal(h.past.length, HISTORY_LIMIT);
  assert.equal(h.past[h.past.length - 1], HISTORY_LIMIT + 9);
});

test('recording the same state twice writes nothing', () => {
  const h = startHistory('a');
  assert.equal(record(h, 'a'), h);
});

test('replace swaps the state without a way back', () => {
  let h = startHistory('a');
  h = record(h, 'b');
  h = replace(h, 'z');
  assert.equal(h.present, 'z');
  assert.equal(canRedo(h), false);
});
