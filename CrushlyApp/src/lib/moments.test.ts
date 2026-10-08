import { test } from 'node:test';
import assert from 'node:assert/strict';

import { groupMomentFeed, type FeedMoment } from './moments';
import type { MomentAuthor } from '../api/types';

const me: MomentAuthor = { id: 1, name: 'Me', photo: null, verified: true, mutual: false };
const ada: MomentAuthor = { id: 2, name: 'Ada', photo: null, verified: false, mutual: true };
const ben: MomentAuthor = { id: 3, name: 'Ben', photo: null, verified: false, mutual: false };

const moment = (over: Partial<FeedMoment>): FeedMoment =>
  ({
    id: 0,
    userId: 0,
    createdAt: 0,
    seen: true,
    expiresAt: 0,
    style: 'champagne',
    caption: '',
    media: null,
    mediaKind: 'photo',
    viewers: [],
    reactions: [],
    viewerCount: 0,
    mine: false,
    ...over,
  }) as unknown as FeedMoment;

test('empty feed still yields my empty group with my card', () => {
  const feed = groupMomentFeed([], me);
  assert.deepEqual(feed.mine, { user: me, moments: [] });
  assert.deepEqual(feed.others, []);
});

test('my moments are collected separately', () => {
  const feed = groupMomentFeed(
    [moment({ id: 1, userId: 1, author: me }), moment({ id: 2, userId: 1, author: me }), moment({ id: 3, userId: 2, author: ada })],
    me,
  );
  assert.equal(feed.mine.moments.length, 2);
  assert.deepEqual(feed.mine.moments.map((m) => m.id), [1, 2]);
  assert.equal(feed.others.length, 1);
  assert.equal(feed.others[0].user.name, 'Ada');
});

test('others sort unseen first, then mutual, then newest', () => {
  const feed = groupMomentFeed(
    [
      moment({ id: 1, userId: 2, author: ada, createdAt: 10, seen: true }), // mutual, seen, older
      moment({ id: 2, userId: 3, author: ben, createdAt: 30, seen: false }), // not mutual, unseen, newest
      moment({ id: 3, userId: 2, author: ada, createdAt: 20, seen: true }), // mutual, seen, newer
    ],
    me,
  );
  const order = feed.others.map((g) => g.user.name);
  // Ada has an older feed but is mutual → comes before Ben? No: Ben is unseen.
  assert.deepEqual(order, ['Ben', 'Ada']);
  assert.equal(feed.others[0].hasUnseen, true);
  assert.equal(feed.others[1].hasUnseen, false);
  assert.equal(feed.others[1].latestAt, 20);
});

test('unseen beats mutual; mutual beats recency', () => {
  const unseenNonMutual = groupMomentFeed(
    [moment({ id: 1, userId: 3, author: ben, createdAt: 5, seen: false }), moment({ id: 2, userId: 2, author: ada, createdAt: 50, seen: true })],
    me,
  );
  assert.equal(unseenNonMutual.others[0].user.name, 'Ben');

  const mutualVsRecent = groupMomentFeed(
    [moment({ id: 1, userId: 3, author: ben, createdAt: 50, seen: true }), moment({ id: 2, userId: 2, author: ada, createdAt: 5, seen: true })],
    me,
  );
  assert.equal(mutualVsRecent.others[0].user.name, 'Ada');
});

test('mixed seen states within one person collapse to one group', () => {
  const feed = groupMomentFeed(
    [moment({ id: 1, userId: 2, author: ada, createdAt: 1, seen: true }), moment({ id: 2, userId: 2, author: ada, createdAt: 2, seen: false })],
    me,
  );
  assert.equal(feed.others.length, 1);
  assert.equal(feed.others[0].hasUnseen, true);
  assert.deepEqual(feed.others[0].moments.map((m) => m.id), [1, 2]);
});
