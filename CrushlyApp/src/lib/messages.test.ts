import { test } from 'node:test';
import assert from 'node:assert/strict';

import { messagePreview, nextMessageCursor, mergeMessagePage } from './messages';
import type { Message } from '../api/types';

const base = {
  id: 7,
  senderId: 2,
  mine: false,
  createdAt: 1,
  status: 'sent',
} as const;

const msg = (over: Record<string, unknown>): Message => ({ ...base, ...over }) as unknown as Message;

test('no messages yet prompts a hello', () => {
  assert.equal(messagePreview(null, 'Ada'), 'You and Ada have a Mutual Crush. Say hello.');
});

test('text messages show sender prefix', () => {
  assert.equal(messagePreview(msg({ kind: 'text', body: 'hi' }), 'Ada'), 'hi');
  assert.equal(messagePreview(msg({ kind: 'text', body: 'hi', mine: true }), 'Ada'), 'You: hi');
});

test('media kinds render friendly labels', () => {
  assert.equal(messagePreview(msg({ kind: 'photo' }), 'Ada'), 'Sent a photo');
  assert.equal(messagePreview(msg({ kind: 'photo', mine: true }), 'Ada'), 'You: Sent a photo');
  assert.equal(messagePreview(msg({ kind: 'voice' }), 'Ada'), 'Voice note');
});

test('stickers show their emoji', () => {
  const sticker = msg({ kind: 'sticker', meta: { sticker: 'wave' } });
  assert.equal(messagePreview(sticker, 'Ada'), '👋 Sticker');
  assert.equal(messagePreview(msg({ kind: 'sticker', meta: { sticker: 'nope' } }), 'Ada'), ' Sticker');
});

test('a shared Space names the person', () => {
  assert.equal(messagePreview(msg({ kind: 'profile', meta: { name: 'Ben' } }), 'Ada'), 'Shared Ben Space');
  assert.equal(messagePreview(msg({ kind: 'profile', meta: {} }), 'Ada'), 'Shared a Space');
  assert.equal(messagePreview(msg({ kind: 'profile', meta: { name: 'Ben' }, mine: true }), 'Ada'), 'You: Shared Ben Space');
});

test('moment replies name whose moment', () => {
  assert.equal(messagePreview(msg({ kind: 'moment_reply' }), 'Ada'), 'Replied to your Moment');
  assert.equal(messagePreview(msg({ kind: 'moment_reply', mine: true }), 'Ada'), 'You replied to Ada’s Moment');
});

test('unknown kinds fall back to the body', () => {
  assert.equal(messagePreview(msg({ kind: 'system' }), 'Ada'), 'New Whisper');
  assert.equal(messagePreview(msg({ kind: 'system', body: 'ok' }), 'Ada'), 'ok');
});

test('sending between polls does not skip an incoming message', () => {
  let cursor = nextMessageCursor(0, 'received', [{ id: 100 }]);
  const database = [{ id: 101 }, { id: 102 }]; // peer sends, then we send
  cursor = nextMessageCursor(cursor, 'sent', [database[1]]);
  assert.equal(cursor, 100);
  const nextPage = database.filter((m) => m.id > cursor);
  assert.deepEqual(nextPage.map((m) => m.id), [101, 102]);
  cursor = nextMessageCursor(cursor, 'received', nextPage);
  assert.equal(cursor, 102);
  assert.equal(nextMessageCursor(cursor, 'received', [{ id: 101 }]), 102);
  assert.equal(nextMessageCursor(cursor, 'received', []), 102);
});

test('catch-up polls keep incoming messages before outgoing ones and deduplicate', () => {
  const draft = msg({ id: -1, pending: true, localId: 'draft' });
  const visible = [msg({ id: 100 }), msg({ id: 102 }), draft];
  const polled = [msg({ id: 101 }), msg({ id: 102 })];
  const merged = mergeMessagePage(visible, polled);
  assert.deepEqual(merged.map((m) => m.id), [100, 101, 102, -1]);
  assert.equal(merged[3], draft);
  assert.deepEqual(mergeMessagePage(merged, polled), merged);
});
