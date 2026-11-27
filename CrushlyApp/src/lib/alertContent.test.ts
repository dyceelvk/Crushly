import { test } from 'node:test';
import assert from 'node:assert/strict';

import { systemAlertFor, titleForKind } from './alertContent';

const badges = (over: Partial<{ messages: number; notifications: number; latestNotification: { id: number; kind: string; body: string } | null }> = {}) => ({
  messages: 0,
  notifications: 0,
  latestNotification: null,
  ...over,
}) as never;

test('a single Whisper is a Whisper, not a count of one', () => {
  const a = systemAlertFor('message', badges({ messages: 1 }));
  assert.equal(a.title, 'New Whisper');
  assert.equal(a.body, 'A Whisper is waiting for you.');
  assert.equal(a.route, 'messages');
});

test('more than one Whisper says how many are waiting', () => {
  assert.equal(systemAlertFor('message', badges({ messages: 3 })).body, '3 new Whispers are waiting.');
});

test('a notification reuses the sentence the notification centre already shows', () => {
  const a = systemAlertFor('notification', badges({
    notifications: 1,
    latestNotification: { id: 42, kind: 'crush', body: 'Riel added up with you' },
  }));
  assert.equal(a.title, 'New Add Up');
  assert.equal(a.body, 'Riel added up with you');
  assert.equal(a.route, 'notifications');
});

test('a notification with nothing to quote still says something honest', () => {
  const a = systemAlertFor('notification', badges({ notifications: 2 }));
  assert.equal(a.title, 'holUpp');
  assert.equal(a.body, '2 new notifications');
});

test('each kind gets its own title, and an unknown kind never renders a raw key', () => {
  assert.equal(titleForKind('post_comment'), 'A new comment');
  assert.equal(titleForKind('post_repost'), 'Somebody reposted your post');
  assert.equal(titleForKind('mutual'), 'It is mutual');
  assert.equal(titleForKind(undefined), 'holUpp');
  assert.equal(titleForKind('something_new' as never), 'holUpp');
});

test('ids differ per event and are stable for the same event', () => {
  const one = systemAlertFor('message', badges({ messages: 2 })).id;
  const two = systemAlertFor('message', badges({ messages: 3 })).id;
  assert.notEqual(one, two);
  assert.equal(one, systemAlertFor('message', badges({ messages: 2 })).id);
  // A Whisper and a notification can never share a slot in the shade.
  assert.notEqual(
    systemAlertFor('notification', badges({ messages: 2, notifications: 2 })).id,
    one,
  );
});
