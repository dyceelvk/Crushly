import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ageFromBirthdate, clockTime, dayLabel, durationLabel, list, nameAge, timeAgo, timeAgoLong } from './format';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const now = Date.now();

test('timeAgo buckets', () => {
  assert.equal(timeAgo(now - 3_000), 'now');
  assert.equal(timeAgo(now - MIN), '1m');
  assert.equal(timeAgo(now - 59 * MIN), '59m');
  assert.equal(timeAgo(now - HOUR), '1h');
  assert.equal(timeAgo(now - 23 * HOUR), '23h');
  assert.equal(timeAgo(now - DAY), '1d');
  assert.equal(timeAgo(now - 6 * DAY), '6d');
  // ≥ 7 days falls back to a locale date like "12 Mar"
  assert.equal(timeAgo(now - 7 * DAY), new Date(now - 7 * DAY).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }));
});

test('timeAgoLong buckets', () => {
  assert.equal(timeAgoLong(now - 3_000), 'Just now');
  assert.equal(timeAgoLong(now - 2 * MIN), '2 min ago');
  assert.equal(timeAgoLong(now - MIN), '1 min ago');
  assert.equal(timeAgoLong(now - 3 * HOUR), '3h ago');
  assert.equal(timeAgoLong(now - HOUR), '1h ago');
  assert.equal(timeAgoLong(now - DAY), 'Yesterday');
  assert.equal(timeAgoLong(now - 2 * DAY), '2 days ago');
  assert.equal(timeAgoLong(now - 6 * DAY), '6 days ago');
  // ≥ 7 days falls back to a locale date like "12 March"
  assert.equal(timeAgoLong(now - 8 * DAY), new Date(now - 8 * DAY).toLocaleDateString(undefined, { day: 'numeric', month: 'long' }));
});

test('clockTime formats without throwing and matches locale shape', () => {
  const out = clockTime(1_700_000_000_000);
  assert.equal(typeof out, 'string');
  assert.ok(out.length > 0);
  // same output as toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const expected = new Date(1_700_000_000_000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  assert.equal(out, expected);
});

test('dayLabel buckets', () => {
  const d = (offsetDays: number) => now - offsetDays * DAY;
  assert.equal(dayLabel(d(0)), 'Today');
  assert.equal(dayLabel(d(1)), 'Yesterday');
  const older = new Date(d(2)).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  assert.equal(dayLabel(d(2)), older);
});

test('durationLabel', () => {
  assert.equal(durationLabel(0), '0:00');
  assert.equal(durationLabel(5), '0:05');
  assert.equal(durationLabel(65), '1:05');
  assert.equal(durationLabel(600), '10:00');
  assert.equal(durationLabel(3_600), '60:00');
});

test('nameAge', () => {
  assert.equal(nameAge('Ada', 24), 'Ada, 24');
  assert.equal(nameAge('Ada', null), 'Ada');
});

test('list joins with bullets and overflows past max', () => {
  assert.equal(list(['Ada', 'Ben']), 'Ada • Ben');
  assert.equal(list(['Ada']), 'Ada');
  assert.equal(list([]), '');
  assert.equal(list(['Ada', 'Ben', 'Cid', 'Dee']), 'Ada • Ben • Cid +1');
  assert.equal(list(['Ada', 'Ben', 'Cid', 'Dee'], 4), 'Ada • Ben • Cid • Dee');
});

test('ageFromBirthdate', () => {
  const today = new Date();
  const y = today.getUTCFullYear();
  // birthday already passed this year (Jan 1) → age is full year delta
  assert.equal(ageFromBirthdate(`${y - 25}-01-01`), 25);
  // birthday later this year (Dec 31) → one less
  assert.equal(ageFromBirthdate(`${y - 25}-12-31`), 24);
  assert.equal(ageFromBirthdate(null), null);
  assert.equal(ageFromBirthdate(undefined), null);
  assert.equal(ageFromBirthdate('nonsense'), null);
});
