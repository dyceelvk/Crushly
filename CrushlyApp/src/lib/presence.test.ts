import { test } from 'node:test';
import assert from 'node:assert/strict';

import { presenceDot, presenceLabel, presenceState, shouldAnnounce, stillTyping, TYPING_TTL_MS } from './presence';

test('the four states are distinct and ordered by how strong the claim is', () => {
  assert.equal(presenceState({ live: true, online: true, activity: 'Online now' }), 'here');
  assert.equal(presenceState({ live: false, online: true, activity: 'Online now' }), 'online');
  assert.equal(presenceState({ live: false, online: false, activity: 'Active 2h ago' }), 'away');
  // Nothing known is "offline", never "maybe": a privacy switch and a closed app
  // are indistinguishable from here, and the screen must not pick one.
  assert.equal(presenceState({ live: false, online: null, activity: null }), 'offline');
});

test('a live socket outranks a five-minute database answer', () => {
  // They are in this conversation now; last_active_at may not have been written
  // yet, and the live fact is the better one.
  assert.equal(presenceState({ live: true, online: false, activity: null }), 'here');
});

test('labels say what they know and nothing more', () => {
  assert.equal(presenceLabel('here', null), 'Here now');
  assert.equal(presenceLabel('online', null), 'Online');
  assert.equal(presenceLabel('away', 'Active today'), 'Active today');
  assert.equal(presenceLabel('away', null), 'Away', 'a state with no label still says something honest');
  assert.equal(presenceLabel('offline', null), 'Offline');
});

test('only two states earn a dot', () => {
  assert.equal(presenceDot('here'), 'live');
  assert.equal(presenceDot('online'), 'warm');
  assert.equal(presenceDot('away'), 'none');
  assert.equal(presenceDot('offline'), 'none');
});

test('presence is announced only when the database says this member allows it', () => {
  assert.equal(shouldAnnounce(true), true);
  assert.equal(shouldAnnounce(false), false);
  assert.equal(shouldAnnounce(null), false);
  assert.equal(shouldAnnounce(undefined), false);
});

test('typing expires on its own', () => {
  const now = 1_000_000;
  assert.equal(stillTyping(now - 10, now), true);
  assert.equal(stillTyping(now - TYPING_TTL_MS - 1, now), false);
  assert.equal(stillTyping(0, now), false, 'zero means "stopped", not "typing since forever"');
});
