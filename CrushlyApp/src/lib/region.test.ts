import assert from 'node:assert/strict';
import test from 'node:test';

import { MIN_GAP_MS, __resetRegionThrottle, deviceCategory, reportRegion, shouldReport } from './region';

test('the first report of a process always goes out', () => {
  assert.equal(shouldReport(1000, undefined), true);
});

test('a second report inside the window is suppressed', () => {
  assert.equal(shouldReport(MIN_GAP_MS - 1, 0), false);
});

test('a report exactly at the window boundary goes out', () => {
  assert.equal(shouldReport(MIN_GAP_MS, 0), true);
});

test('a device clock that jumps backwards does not lock reporting out', () => {
  assert.equal(shouldReport(500, 10_000), true);
});

test('nonsense timestamps fail open rather than closed', () => {
  assert.equal(shouldReport(Number.NaN, 5), true);
  assert.equal(shouldReport(5, Number.NaN), true);
});

test('device category is a coarse bucket, never an identifier', () => {
  assert.equal(deviceCategory('android'), 'android');
  assert.equal(deviceCategory('ios'), 'ios');
  assert.equal(deviceCategory('web'), 'web');
  assert.equal(deviceCategory('windows'), 'desktop');
  assert.equal(deviceCategory('something-else'), 'unknown');
});

test('a failed lookup is silent and returns null', async () => {
  __resetRegionThrottle();
  const calls: Record<string, unknown>[] = [];
  const result = await reportRegion('LOGIN', {
    now: 1_000_000,
    invoke: async (body) => {
      calls.push(body);
      throw new Error('network down');
    },
  });
  assert.equal(result, null);
  assert.equal(calls.length, 1);
  // Nothing location-shaped was sent by the client.
  assert.equal('country' in calls[0], false);
  assert.equal('ip' in calls[0], false);
});

test('two reports in quick succession produce one request', async () => {
  __resetRegionThrottle();
  let count = 0;
  const invoke = async () => {
    count += 1;
    return { identified: true, country: 'NG' };
  };
  await reportRegion('LOGIN', { now: 2_000_000, invoke });
  const second = await reportRegion('SESSION_REFRESH', { now: 2_000_100, invoke });
  assert.equal(count, 1);
  assert.equal(second, null);
});

test('after the window elapses the next report goes out', async () => {
  __resetRegionThrottle();
  let count = 0;
  const invoke = async () => {
    count += 1;
    return { identified: true };
  };
  await reportRegion('LOGIN', { now: 3_000_000, invoke });
  await reportRegion('SESSION_REFRESH', { now: 3_000_000 + MIN_GAP_MS, invoke });
  assert.equal(count, 2);
});

test('force bypasses the throttle for explicit events', async () => {
  __resetRegionThrottle();
  let count = 0;
  const invoke = async () => {
    count += 1;
    return { identified: true };
  };
  await reportRegion('LOGIN', { now: 4_000_000, invoke });
  await reportRegion('WITHDRAWAL', { now: 4_000_100, force: true, invoke });
  assert.equal(count, 2);
});
