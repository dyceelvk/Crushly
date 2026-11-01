import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MATCH_WINDOW_MS, pendingMatch, shouldOpenMoment, type MatchCandidate } from './matchMoment';

const now = 1_800_000_000_000;
const seenNothing = () => false;
const who = { id: 7, name: 'Ngozi', photo: 'face.jpg' };
const match = (over: Partial<MatchCandidate> & { id: number }): MatchCandidate => ({
  kind: 'mutual',
  read: false,
  createdAt: now - 60_000,
  actor: who,
  ...over,
});

test('the person who feels it second opens the moment immediately', () => {
  assert.equal(shouldOpenMoment('mutual', 7, seenNothing), true);
});

test('every other notification keeps behaving like a toast', () => {
  for (const kind of ['crush', 'deep_crush', 'message', 'moment_reply', 'verified', 'moment_reaction']) {
    assert.equal(shouldOpenMoment(kind, 7, seenNothing), false, kind);
  }
  assert.equal(shouldOpenMoment(null, 7, seenNothing), false);
  // A mutual with nobody attached cannot open a screen about nobody.
  assert.equal(shouldOpenMoment('mutual', null, seenNothing), false);
});

test('a moment is never shown twice in one session', () => {
  const seen = new Set([7]);
  assert.equal(shouldOpenMoment('mutual', 7, (id) => seen.has(id)), false);
});

test('a match that arrived while the app was closed greets you on launch', () => {
  const n = pendingMatch([match({ id: 1 })], now, seenNothing);
  assert.equal(n?.id, 1);
});

test('an old match is not news', () => {
  const older = match({ id: 2, createdAt: now - MATCH_WINDOW_MS - 1 });
  assert.equal(pendingMatch([older], now, seenNothing), null);
  // Right on the edge is still news.
  const edge = match({ id: 3, createdAt: now - MATCH_WINDOW_MS });
  assert.equal(pendingMatch([edge], now, seenNothing)?.id, 3);
});

test('what has been read, or already celebrated, stays quiet', () => {
  assert.equal(pendingMatch([match({ id: 4, read: true })], now, seenNothing), null);
  assert.equal(pendingMatch([match({ id: 5 })], now, (id) => id === 7), null);
});

test('the newest match wins when several are waiting', () => {
  const list = [
    match({ id: 10, createdAt: now - 5_000, actor: { ...who, id: 1 } }),
    match({ id: 11, createdAt: now - 1_000, actor: { ...who, id: 2 } }),
    match({ id: 12, createdAt: now - 900_000, actor: { ...who, id: 3 } }),
  ];
  assert.equal(pendingMatch(list, now, seenNothing)?.id, 11);
});

test('nothing waiting is not a crash', () => {
  assert.equal(pendingMatch([], now, seenNothing), null);
  assert.equal(pendingMatch(null, now, seenNothing), null);
  assert.equal(pendingMatch(undefined, now, seenNothing), null);
  assert.equal(pendingMatch([match({ id: 20, kind: 'crush' })], now, seenNothing), null);
  assert.equal(pendingMatch([match({ id: 21, actor: null })], now, seenNothing), null);
});

test('a match with no timestamp is still news, not silence', () => {
  const undated: MatchCandidate = { id: 30, kind: 'mutual', read: false, actor: who };
  assert.equal(pendingMatch([undated], now, seenNothing)?.id, 30);
});
