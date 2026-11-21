import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEB_LIMIT_MS, shouldWarn, timeLeftLabel, webLimitCopy, webPlatform, webStanding, type WebClock } from './webLimit';

const clock = (over: Partial<WebClock> = {}): WebClock => ({
  firstSeenAt: 1_700_000_000_000,
  elapsedMs: 60_000,
  remainingMs: WEB_LIMIT_MS - 60_000,
  blocked: false,
  ...over,
});

test('inside the 24 hours nothing changes, on every platform', () => {
  for (const platform of ['ios', 'android', 'other'] as const) {
    assert.equal(webStanding(clock(), platform), 'open');
  }
});

test('no clock yet (signed out, or first paint) is not a block', () => {
  assert.equal(webStanding(null, 'ios'), 'open');
  assert.equal(webStanding(undefined, 'android'), 'open');
});

test('the server-side unlimited result stays open and never warns', () => {
  const unlimited = clock({ unlimited: true, blocked: true, remainingMs: 0 });
  assert.equal(webStanding(unlimited, 'android'), 'open');
  assert.equal(shouldWarn(unlimited), false);
});

test('Android gets the wall because there is an app to send it to', () => {
  assert.equal(webStanding(clock({ blocked: true, remainingMs: 0 }), 'android'), 'wall');
});

test('iPhone gets read-only, never a wall it cannot get past', () => {
  // The phone cannot install from an app store, so a wall would be a dead end:
  // every readable screen stays readable, posting is what stops.
  assert.equal(webStanding(clock({ blocked: true, remainingMs: 0 }), 'ios'), 'readonly');
  assert.equal(webStanding(clock({ blocked: true, remainingMs: 0 }), 'other'), 'readonly');
});

test('the copy for a wall offers the app; the copy for read-only offers a home screen', () => {
  assert.match(webLimitCopy('wall').cta ?? '', /app/i);
  assert.match(webLimitCopy('readonly').cta ?? '', /Home Screen/i);
  assert.equal(webLimitCopy('open').cta, null);
});

test('the wall never claims writing is still possible', () => {
  for (const standing of ['wall', 'readonly'] as const) {
    assert.match(webLimitCopy(standing).title, /up|read-only/i);
  }
});

test('time left rounds down, so 23h59m is not called a day', () => {
  assert.equal(timeLeftLabel(WEB_LIMIT_MS - 1000), '23 hours left');
  assert.equal(timeLeftLabel(2 * 60 * 60 * 1000 + 30_000), '2 hours left');
  assert.equal(timeLeftLabel(47 * 60 * 1000), '47 minutes left');
  assert.equal(timeLeftLabel(60 * 1000), '1 minute left');
  assert.equal(timeLeftLabel(10_000), 'Less than a minute left');
  assert.equal(timeLeftLabel(0), 'No time left');
});

test('the warning fires once, in the last six hours, and never after the wall', () => {
  assert.equal(shouldWarn(clock({ remainingMs: 7 * 60 * 60 * 1000 })), false);
  assert.equal(shouldWarn(clock({ remainingMs: 6 * 60 * 60 * 1000 })), true);
  assert.equal(shouldWarn(clock({ remainingMs: 60_000 })), true);
  assert.equal(shouldWarn(clock({ remainingMs: 0, blocked: true })), false);
  assert.equal(shouldWarn(null), false);
});

test('platform detection sends iPadOS masquerading as a Mac to other, not android', () => {
  assert.equal(webPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X)'), 'ios');
  assert.equal(webPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8)'), 'android');
  assert.equal(webPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), 'other');
  assert.equal(webPlatform(undefined), 'other');
});
