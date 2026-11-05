import { test } from 'node:test';
import assert from 'node:assert/strict';
import { circleNotificationText, circleRoute, isCircleNotification } from './circleNotifications';

const ROOM = 'Sunday Go Sharp';

test('every Circle notification names the person and the room', () => {
  for (const kind of ['circle_request', 'circle_approved', 'circle_joined', 'circle_declined', 'circle_invite'] as const) {
    const { title } = circleNotificationText(kind, ROOM, 'Riel Inc.');
    assert.match(title, /Riel Inc\./, kind);
    assert.ok(title.includes(ROOM), `${kind}: ${title}`);
  }
});

test('being let in and somebody getting in are not the same sentence', () => {
  const mine = circleNotificationText('circle_approved', ROOM, 'Riel Inc.').title;
  const theirs = circleNotificationText('circle_joined', ROOM, 'Ada').title;
  assert.notEqual(mine, theirs);
  assert.match(mine, /let you into/);
  assert.match(theirs, /is now in/);
});

test('a request is work: it opens the Requests list, not the roster', () => {
  const to = circleRoute('circle_request', 5);
  assert.deepEqual(to, { screen: 'CircleManage', params: { circleId: 5, tab: 'requests' } });
});

test('membership news opens the room; a decline or an invitation opens the preview', () => {
  assert.equal(circleRoute('circle_approved', 5)?.screen, 'Circle');
  assert.equal(circleRoute('circle_joined', 5)?.screen, 'Circle');
  assert.equal(circleRoute('circle_declined', 5)?.screen, 'CirclePreview');
  assert.equal(circleRoute('circle_invite', 5)?.screen, 'CirclePreview');
});

test('a Circle with no id is not a destination', () => {
  assert.equal(circleRoute('circle_request', 0), null);
});

test('only Circle kinds are Circle kinds', () => {
  assert.equal(isCircleNotification('circle_invite'), true);
  assert.equal(isCircleNotification('crush'), false);
  assert.equal(isCircleNotification('message'), false);
});
