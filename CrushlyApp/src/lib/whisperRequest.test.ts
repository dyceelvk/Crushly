import assert from 'node:assert/strict';
import test from 'node:test';
import { whisperRowLabel, whisperView, type WhisperState } from './whisperRequest';

/**
 * The rule from the owner: a Whisper has to be *requested*, the request opens
 * the chat, two messages are allowed, and the other person accepts or declines
 * inside that chat. These cases pin the exact words and the composer's rules.
 */

const base = (over: Partial<WhisperState> = {}): WhisperState => ({
  state: 'pending',
  sent: 0,
  requester: true,
  remaining: 2,
  canSend: true,
  needsDecision: false,
  peerOpen: false,
  ...over,
});

test('a thread with no request state keeps working as it always did', () => {
  const v = whisperView(null, 'Joma');
  assert.equal(v.kind, 'none');
  assert.equal(v.canCompose, true);
  assert.equal(whisperRowLabel(null), null);
});

test('the asker may write two messages and is told how many are left', () => {
  const first = whisperView(base({ sent: 0 }), 'Joma');
  assert.equal(first.kind, 'waiting');
  assert.equal(first.canCompose, true);
  assert.match(first.body, /2 messages/);

  const second = whisperView(base({ sent: 1, remaining: 1 }), 'Joma');
  assert.equal(second.canCompose, true);
  assert.match(second.body, /1 of 2 messages sent — 1 left/);
});

test('after two messages the composer closes until the other person answers', () => {
  const v = whisperView(base({ sent: 2, remaining: 0, canSend: false }), 'Joma');
  assert.equal(v.canCompose, false);
  assert.equal(v.showDecision, false);
  assert.match(v.body, /Waiting for Joma to accept/);
});

test('open messaging on their side is said out loud, not left as a mystery', () => {
  const v = whisperView(base({ sent: 2, remaining: 0, canSend: false, peerOpen: true }), 'Joma');
  assert.match(v.body, /open messaging/);
});

test('the recipient is asked to accept or decline inside the thread', () => {
  const v = whisperView(base({ requester: false, needsDecision: true, sent: 2, remaining: null }), 'Joma');
  assert.equal(v.kind, 'decision');
  assert.equal(v.showDecision, true);
  assert.equal(v.canCompose, true, 'replying is also an answer');
  assert.match(v.title, /Joma wants to Whisper/);
  assert.match(v.body, /2 messages are waiting/);
});

test('one waiting message reads as one, not "1 messages"', () => {
  const v = whisperView(base({ requester: false, needsDecision: true, sent: 1, remaining: null }), 'Joma');
  assert.match(v.body, /1 message is waiting/);
});

test('accepted: no counters, no prompts, the conversation is just a conversation', () => {
  const v = whisperView(base({ state: 'accepted', remaining: null, canSend: true }), 'Joma');
  assert.equal(v.kind, 'none');
  assert.equal(v.canCompose, true);
  assert.equal(whisperRowLabel(base({ state: 'accepted' })), null);
});

test('declined and blocked both close the composer, and say which happened', () => {
  const declined = whisperView(base({ state: 'declined', canSend: false }), 'Joma');
  assert.equal(declined.kind, 'declined');
  assert.equal(declined.canCompose, false);
  assert.match(declined.title, /declined/);

  const blocked = whisperView(base({ state: 'blocked', canSend: false }), 'Joma');
  assert.equal(blocked.kind, 'blocked');
  assert.equal(blocked.canCompose, false);
});

test('the conversation row says what is waiting', () => {
  assert.equal(whisperRowLabel(base({ requester: false, needsDecision: true, sent: 2 })), 'Wants to Whisper');
  assert.equal(whisperRowLabel(base({ sent: 0 })), 'Request sent');
  assert.equal(whisperRowLabel(base({ sent: 1 })), 'Request sent · 1/2');
});

test('a nameless peer never renders an empty title', () => {
  const v = whisperView(base({ requester: false, needsDecision: true, sent: 1 }), '');
  assert.match(v.title, /They wants to Whisper/);
  // The wording is clumsy but never blank; the screen passes the real name.
  assert.ok(v.title.length > 0);
});
