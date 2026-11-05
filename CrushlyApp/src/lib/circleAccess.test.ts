import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinAction, activityLine, policyLabel } from './circleAccess';

test('a member is never offered a way in', () => {
  const a = joinAction({ state: 'member', joinPolicy: 'open' });
  assert.equal(a.kind, 'member');
  assert.equal(a.pressable, false);
});

test('a pending request is a fact, not a button', () => {
  const a = joinAction({ state: 'pending', joinPolicy: 'request' });
  assert.equal(a.label, 'Request sent');
  assert.equal(a.pressable, false);
});

test('an invitation asks a different question from a request', () => {
  assert.equal(joinAction({ state: 'invited', joinPolicy: 'invite' }).label, 'Accept invitation');
  assert.equal(joinAction({ state: 'none', joinPolicy: 'invite' }).label, 'Invitation only');
});

test('the policy decides the verb for a stranger', () => {
  assert.equal(joinAction({ state: 'none', joinPolicy: 'open' }).label, 'Join');
  assert.equal(joinAction({ state: 'none', joinPolicy: 'request' }).label, 'Request to join');
});

test('a full room says so instead of offering a door that cannot open', () => {
  const a = joinAction({ state: 'none', joinPolicy: 'open', full: true });
  assert.equal(a.kind, 'full');
  assert.equal(a.pressable, false);
});

test('your own situation beats the policy of the room', () => {
  assert.equal(joinAction({ state: 'pending', joinPolicy: 'open' }).kind, 'pending');
  assert.equal(joinAction({ state: 'invited', joinPolicy: 'invite' }).kind, 'accept');
});

test('a discovery line is counts, not adjectives', () => {
  assert.equal(activityLine({ memberCount: 5, postsThisWeek: 2, messagesThisWeek: 0 }), '5/12 · 2 posts this week');
  assert.equal(activityLine({ memberCount: 3, postsThisWeek: 0, messagesThisWeek: 1 }), '3/12 · 1 message');
  assert.equal(activityLine({ memberCount: 3, postsThisWeek: 0, messagesThisWeek: 0 }), '3/12 · no activity yet');
  assert.equal(
    activityLine({ memberCount: 4, postsThisWeek: 1, messagesThisWeek: 3, friendsInside: 1 }),
    '4/12 · 1 post this week · 3 messages · 1 connection inside',
  );
});

test('the owner reads their own policy back in plain words', () => {
  assert.equal(policyLabel('open'), 'Anyone can join');
  assert.equal(policyLabel('request'), 'Ask to join');
  assert.equal(policyLabel('invite'), 'Invitation only');
});
