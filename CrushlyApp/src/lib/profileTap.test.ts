import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveMomentUserIds, momentViewerParams, profileDestination } from './profileTap';

const live = (...ids: number[]) => new Set(ids);

test('nobody live: the picture opens the Space', () => {
  assert.equal(profileDestination({ userId: 7, liveMoments: live() }), 'space');
});

test('a live Moment: the picture opens the Moment first', () => {
  assert.equal(profileDestination({ userId: 7, liveMoments: live(7) }), 'moment');
});

test('somebody else being live does not open their Moment', () => {
  assert.equal(profileDestination({ userId: 7, liveMoments: live(9) }), 'space');
});

test('inside somebody’s Moment, their picture opens their Space', () => {
  assert.equal(profileDestination({ userId: 7, liveMoments: live(7), viewingMomentOf: 7 }), 'space');
});

test('inside somebody’s Moment, another live person still opens their Moment', () => {
  assert.equal(profileDestination({ userId: 9, liveMoments: live(7, 9), viewingMomentOf: 7 }), 'moment');
});

test('inside a Moment that has since expired, the picture is still the way out', () => {
  assert.equal(profileDestination({ userId: 7, liveMoments: live(), viewingMomentOf: 7 }), 'space');
});

test('your own picture follows the same rule as anybody else’s', () => {
  assert.equal(profileDestination({ userId: 1, liveMoments: live(1) }), 'moment');
  assert.equal(profileDestination({ userId: 1, liveMoments: live(1), viewingMomentOf: 1 }), 'space');
  assert.equal(profileDestination({ userId: 1, liveMoments: live() }), 'space');
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
