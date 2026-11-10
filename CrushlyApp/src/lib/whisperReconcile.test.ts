import { test } from 'node:test';
import { deepStrictEqual } from 'node:assert';
import type { Message } from '../api/types';
import { reconcileWhisperMessages } from './whisperReconcile';

const message = (id: number, meta: Record<string, unknown> = {}): Message => ({
  id, conversationId: 1, senderId: 1, mine: true, kind: 'text', body: 'example',
  mediaUrl: null, meta, createdAt: 0, readAt: null, reactions: [],
});

test('deleted messages and their quoted previews disappear, unrelated and new items stay', () => {
  const items = [message(1), message(2, { replyTo: { id: 1, preview: 'private' }, other: true }), message(-1), message(3)];
  const output = reconcileWhisperMessages(items, new Set([1, 2]), new Set([2]));
  deepStrictEqual(output.map((m) => m.id), [2, -1, 3]);
  deepStrictEqual(output[0].meta, { other: true });
});

test('a visible original retains its quote', () => {
  const items = [message(2, { replyTo: { id: 1, preview: 'hello' } })];
  deepStrictEqual(reconcileWhisperMessages(items, new Set([1, 2]), new Set([1, 2])), items);
});
