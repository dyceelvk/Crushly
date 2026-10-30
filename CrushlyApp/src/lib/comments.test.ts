import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PostComment } from '../api/types';
import {
  answererStack,
  canSendComment,
  commentRows,
  composerOffset,
  sheetPlacement,
  threadTotal,
} from './comments';

const author = {
  id: 1, name: 'Someone', age: 30, city: null, bio: '', online: false, photos: [],
  verification: 'none', crush: { note: null, sent: false, mutual: false, received: false, sentDeep: false, receivedDeep: false },
} as unknown as PostComment['author'];

/** A comment, with only the parts a given test cares about spelled out. */
const c = (
  id: number,
  parentId: number | null,
  extra: Partial<Pick<PostComment, 'hidden' | 'replyCount'>> = {},
): PostComment => ({
  id,
  parentId,
  hidden: extra.hidden ?? false,
  replyCount: extra.replyCount ?? 0,
  body: extra.hidden ? null : `body ${id}`,
  createdAt: 0,
  mine: false,
  canDelete: false,
  likeCount: 0,
  liked: false,
  author,
});

test('an open thread is ordered parents-then-answers, answers never nested twice', () => {
  const rows = commentRows([c(1, null), c(2, 1), c(3, 1), c(4, null)], [1]);
  assert.deepEqual(rows.map((r) => [r.comment.id, r.depth]), [
    [1, 0], [2, 1], [3, 1], [4, 0],
  ]);
});

test('an answer whose parent is missing is promoted, not lost', () => {
  // A parent that was hard-deleted by the owner leaves its answers behind
  // pointing at nothing. They must still be reachable.
  const rows = commentRows([c(7, 99)]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].depth, 0);
});

test('collapsed answers are hidden but the parent still shows its count', () => {
  const collapsed = commentRows([c(1, null, { replyCount: 2 }), c(2, 1), c(3, 1)]);
  assert.deepEqual(collapsed.map((r) => r.comment.id), [1]);
  const open = commentRows([c(1, null, { replyCount: 2 }), c(2, 1), c(3, 1)], [1]);
  assert.deepEqual(open.map((r) => r.comment.id), [1, 2, 3]);
});

test('the count in the heading never counts answers as comments', () => {
  assert.equal(threadTotal([c(1, null, { replyCount: 1 }), c(2, 1)]), 1);
  assert.equal(threadTotal([c(1, null), c(2, null), c(3, 1)]), 2);
});

test('the answerer stack is at most two real faces', () => {
  const stack = answererStack([c(1, null), c(2, 1), c(3, 1), c(4, 1)]);
  assert.equal(stack.get(1)?.length, 2);
  assert.ok(stack.get(1)?.every((r) => r.parentId === 1));
});

test('a draft of only spaces cannot be sent, and neither can one while sending', () => {
  assert.equal(canSendComment('', false), false);
  assert.equal(canSendComment('   \n ', false), false);
  assert.equal(canSendComment('hello', true), false);
  assert.equal(canSendComment('hello', false), true);
});

test('the composer clears the home indicator but hugs the bottom of the sheet', () => {
  assert.equal(composerOffset(0), 12);
  assert.equal(composerOffset(34), 34);
  // On web/desktop there is no inset; the composer must not float.
  assert.equal(composerOffset(undefined), 12);
});

test('a sheet whose content overflows still fits above the bottom edge', () => {
  // 874px phone: the sheet is 78% tall and must end exactly at the bottom.
  const p = sheetPlacement({ viewportHeight: 874, keyboardHeight: 0 });
  assert.ok(Math.abs(p.height - 874 * 0.78) < 0.001);
  assert.ok(Math.abs(p.top + p.height - 874) < 0.001);
});

test('an open keyboard lifts the sheet instead of hiding the composer', () => {
  const withKeyboard = sheetPlacement({ viewportHeight: 874, keyboardHeight: 300 });
  const without = sheetPlacement({ viewportHeight: 874, keyboardHeight: 0 });
  assert.ok(Math.abs(withKeyboard.top + withKeyboard.height - (874 - 300)) < 0.001);
  assert.ok(withKeyboard.height <= without.height);
  // Even on a short screen the sheet keeps room for at least one comment.
  assert.ok(withKeyboard.height >= 180, `sheet collapsed to ${withKeyboard.height}px`);
});

test('a tall screen never grows the sheet past its cap', () => {
  const p = sheetPlacement({ viewportHeight: 2000, keyboardHeight: 0 });
  assert.equal(p.height, 720);
});
