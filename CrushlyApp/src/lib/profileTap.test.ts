import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveMomentUserIds, momentViewerParams, profileDestination } from './profileTap';

const live = (...ids: number[]) => new Set(ids);

/*
 * The ring is the door.
 *
 * These tests were rewritten for 1.0.69 because the rule changed, and it is
 * worth saying what changed: a live Moment used to be enough on its own, so a
 * picture opened the viewer whenever *anything* was behind it. That is why a
 * name could open a Moment and why a face in a chat header could load a Moment
 * with nothing drawn around it. Now the caller has to say that the thing it drew
 * was a ring, and everything else opens the Space.
 */

test('nothing live: the picture opens the Space', () => {
  assert.equal(profileDestination({ userId: 7, surface: 'ring', liveMoments: live() }), 'space');
});

test('a ring with a live Moment opens the Moment', () => {
  assert.equal(profileDestination({ userId: 7, surface: 'ring', liveMoments: live(7) }), 'moment');
});

test('a ring with nothing live is still just a face, and opens the Space', () => {
  assert.equal(profileDestination({ userId: 7, surface: 'ring', liveMoments: live(9) }), 'space');
});

test('a picture with no ring never opens a Moment, even when one is live', () => {
  assert.equal(profileDestination({ userId: 7, surface: 'plain', liveMoments: live(7) }), 'space');
  // A name and a chat header are `plain` by omission: a caller that has not said
  // it drew a ring did not draw one.
  assert.equal(profileDestination({ userId: 7, liveMoments: live(7) }), 'space');
});

test('inside somebody’s Moment, their ring opens their Space', () => {
  assert.equal(profileDestination({ userId: 7, surface: 'ring', liveMoments: live(7), viewingMomentOf: 7 }), 'space');
});

test('inside somebody’s Moment, another live ring still opens that Moment', () => {
  assert.equal(profileDestination({ userId: 9, surface: 'ring', liveMoments: live(7, 9), viewingMomentOf: 7 }), 'moment');
});

test('inside a Moment that has since expired, the picture is still the way out', () => {
  assert.equal(profileDestination({ userId: 7, surface: 'ring', liveMoments: live(), viewingMomentOf: 7 }), 'space');
});

test('your own ring follows the same rule as anybody else’s', () => {
  assert.equal(profileDestination({ userId: 1, surface: 'ring', liveMoments: live(1) }), 'moment');
  assert.equal(profileDestination({ userId: 1, surface: 'ring', liveMoments: live(1), viewingMomentOf: 1 }), 'space');
  assert.equal(profileDestination({ userId: 1, liveMoments: live(1) }), 'space');
});

test('the live set comes from what the backend returned, mine included', () => {
  const ids = liveMomentUserIds({
    mine: { user: { id: 1 } },
    others: [{ user: { id: 4 } }, { user: { id: 9 } }],
  });
  assert.deepEqual([...ids].sort((a, b) => a - b), [1, 4, 9]);
});

test('no Moments at all is an empty set, not a crash', () => {
  assert.equal(liveMomentUserIds(undefined).size, 0);
  assert.equal(liveMomentUserIds(null).size, 0);
  assert.equal(liveMomentUserIds({ others: [] }).size, 0);
});

test('your own ring opens your own Moment, not somebody else’s screen', () => {
  assert.deepEqual(momentViewerParams(1, 1), { userId: 1, mine: true });
  assert.deepEqual(momentViewerParams(4, 1), { userId: 4, mine: false });
});

test('a ring tapped before the viewer’s own id is known still opens a Moment', () => {
  assert.deepEqual(momentViewerParams(4, null), { userId: 4, mine: false });
  assert.deepEqual(momentViewerParams(4, undefined), { userId: 4, mine: false });
});
