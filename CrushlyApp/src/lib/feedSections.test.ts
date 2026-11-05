import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFeedRows } from './feedSections';

const key = (n: number) => `p${n}`;
const posts = [1, 2, 3, 4];

test('a section sits after the post it was placed after', () => {
  const rows = buildFeedRows(posts, [{ after: 1, key: 'highlights' }], key);
  assert.deepEqual(rows.map((r) => r.key), ['p1', 'highlights', 'p2', 'p3', 'p4']);
});

test('two sections keep their order and their positions', () => {
  const rows = buildFeedRows(posts, [{ after: 3, key: 'discover' }, { after: 1, key: 'highlights' }], key);
  assert.deepEqual(rows.map((r) => r.key), ['p1', 'highlights', 'p2', 'p3', 'discover', 'p4']);
});

test('a section past the end of the feed is appended, not dropped', () => {
  const rows = buildFeedRows([1], [{ after: 7, key: 'discover' }], key);
  assert.deepEqual(rows.map((r) => r.key), ['p1', 'discover']);
});

test('an empty feed still carries its sections', () => {
  const rows = buildFeedRows([], [{ after: 1, key: 'highlights' }, { after: 3, key: 'discover' }], key);
  assert.deepEqual(rows.map((r) => r.key), ['highlights', 'discover']);
});

test('every post appears exactly once', () => {
  const rows = buildFeedRows(posts, [{ after: 0, key: 'a' }, { after: 2, key: 'b' }, { after: 2, key: 'c' }], key);
  const items = rows.flatMap((r) => (r.kind === 'item' ? [r.item] : []));
  assert.deepEqual(items, posts);
});
