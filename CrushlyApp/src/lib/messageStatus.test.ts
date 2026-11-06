import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyUpTo, messageStatus, statusRank, unreadFrom } from './messageStatus';
import type { Message } from '../api/types';

const msg = (over: Partial<Message>): Message => ({
  id: 10,
  conversationId: 1,
  senderId: 2,
  mine: true,
  kind: 'text',
  body: 'hi',
  mediaUrl: null,
  meta: {},
  createdAt: 1,
  readAt: null,
  deliveredAt: null,
  reactions: [],
  ...over,
});

test('the ladder climbs from sending to read and only reports my own messages', () => {
  assert.equal(messageStatus(msg({ mine: false, readAt: 5, deliveredAt: 4 })), null, 'their message is not mine to report');
  assert.equal(messageStatus(msg({ pending: true })), 'sending');
  assert.equal(messageStatus(msg({ failed: true, pending: false })), 'failed');
  assert.equal(messageStatus(msg({})), 'sent');
  assert.equal(messageStatus(msg({ deliveredAt: 5 })), 'delivered');
  assert.equal(messageStatus(msg({ deliveredAt: 5, readAt: 6 })), 'read');
  // A failed message that somehow also carries a read stamp is still failed:
  // the server refusing it is the more important fact.
  assert.equal(messageStatus(msg({ failed: true, readAt: 6 })), 'failed');
});

test('rank orders the ladder so two sources cannot disagree downwards', () => {
  assert.ok(statusRank('read') > statusRank('delivered'));
  assert.ok(statusRank('delivered') > statusRank('sent'));
  assert.ok(statusRank('sent') > statusRank('sending'));
  assert.equal(statusRank(null), -1);
});

test('an up-to event stamps my messages and stops at the id', () => {
  const list = [msg({ id: 1 }), msg({ id: 2 }), msg({ id: 3 })];
  const after = applyUpTo(list, 2, 'readAt', 99);
  assert.equal(after[0].readAt, 99);
  assert.equal(after[1].readAt, 99);
  assert.equal(after[2].readAt, null, 'a later message is not covered by an earlier watermark');
  assert.equal(applyUpTo(after, 2, 'readAt', 100)[1].readAt, 99, 'an already-stamped message is not re-stamped');
});

test('up-to ignores drafts, their messages and junk watermarks', () => {
  const list = [msg({ id: -5, pending: true }), msg({ id: 4, mine: false })];
  const after = applyUpTo(list, 10, 'deliveredAt', 7);
  assert.equal(after[0].deliveredAt, null, 'a draft has not been sent, so nothing can have delivered it');
  assert.equal(after[1].deliveredAt, null, 'their message is not delivered by them');
  const same = applyUpTo(list, 0, 'readAt');
  assert.equal(same, list, 'a zero watermark changes nothing and returns the same array');
});

test('unread counts only their real messages', () => {
  assert.equal(
    unreadFrom([msg({ id: 1, mine: false }), msg({ id: 2, mine: false, readAt: 5 }), msg({ id: 3 }), msg({ id: -1, mine: false, pending: true })]),
    1,
  );
});
