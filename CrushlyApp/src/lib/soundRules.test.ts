import { test } from 'node:test';
import assert from 'node:assert/strict';

import { alertFor, MIN_GAP_MS, shouldPlay } from './soundRules';

const base = { enabled: true, suppressed: false, appActive: true, now: 10_000, lastPlayedAt: 0 };

test('a chime plays when the app is open, nothing is suppressed and the switch is on', () => {
  assert.equal(shouldPlay(base), true);
});

test('the member\u2019s switch is obeyed first', () => {
  assert.equal(shouldPlay({ ...base, enabled: false }), false);
});

test('the screen that owns the sound can silence it', () => {
  // A Whisper arriving in the room you are reading is not news.
  assert.equal(shouldPlay({ ...base, suppressed: true }), false);
});

test('nothing plays from a backgrounded app', () => {
  assert.equal(shouldPlay({ ...base, appActive: false }), false);
});

test('two events a moment apart are one chime', () => {
  assert.equal(shouldPlay({ ...base, lastPlayedAt: base.now - 200 }), false);
  assert.equal(shouldPlay({ ...base, lastPlayedAt: base.now - MIN_GAP_MS }), true);
});

test('a clock that jumped backwards stays quiet instead of chiming forever', () => {
  assert.equal(shouldPlay({ ...base, lastPlayedAt: base.now + 60_000 }), false);
});

test('the first reading is the state of the world, not an event', () => {
  assert.equal(alertFor(null, { messages: 3, notifications: 7 }), null);
});

test('an increase is an alert; no change is silence', () => {
  assert.equal(alertFor({ messages: 0, notifications: 0 }, { messages: 0, notifications: 0 }), null);
  assert.equal(alertFor({ messages: 0, notifications: 0 }, { messages: 1, notifications: 0 }), 'message');
  assert.equal(alertFor({ messages: 0, notifications: 2 }, { messages: 0, notifications: 3 }), 'notification');
});

test('a message wins when both went up in the same poll', () => {
  assert.equal(alertFor({ messages: 1, notifications: 1 }, { messages: 2, notifications: 2 }), 'message');
});

test('reading things makes the count go down, which is not an alert', () => {
  assert.equal(alertFor({ messages: 4, notifications: 4 }, { messages: 0, notifications: 0 }), null);
});
