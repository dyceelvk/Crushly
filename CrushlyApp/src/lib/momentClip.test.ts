import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MOMENT_CLIP_SECONDS,
  clampWindow,
  clipTimeLabel,
  openingWindow,
  pickerSeconds,
} from './momentClip';

test('a Moment clip is 25 seconds, not a minute', () => {
  assert.equal(MOMENT_CLIP_SECONDS, 25);
});

test('a picker duration in milliseconds becomes seconds', () => {
  assert.equal(pickerSeconds(25_400), 25.4);
  assert.equal(pickerSeconds(9_800), 9.8);
});

test('a picker duration already in seconds is left alone', () => {
  assert.equal(pickerSeconds(25.4), 25.4);
  assert.equal(pickerSeconds(3), 3);
});

test('an unusable duration is null, never zero', () => {
  // The bug this exists for: 0 was treated as "a one-second clip", so the trim
  // screen offered a one-second window over a file it had not measured.
  assert.equal(pickerSeconds(0), null);
  assert.equal(pickerSeconds(undefined), null);
  assert.equal(pickerSeconds(null), null);
  assert.equal(pickerSeconds(Number.NaN), null);
  assert.equal(pickerSeconds(-4), null);
});

test('a 25-second reading of a 25-second file is not mistaken for 0.025s', () => {
  // Seconds in, seconds out — the case that produced a one-second Moment.
  assert.equal(pickerSeconds(25), 25);
  assert.deepEqual(openingWindow(pickerSeconds(25)!, MOMENT_CLIP_SECONDS), { start: 0, end: 25 });
});

test('the window opens on the whole clip when it is short enough', () => {
  assert.deepEqual(openingWindow(9.4), { start: 0, end: 9.4 });
});

test('the window opens on the first 25 seconds of a longer clip', () => {
  assert.deepEqual(openingWindow(48), { start: 0, end: 25 });
});

test('an unmeasured clip has no window instead of a one-second one', () => {
  assert.deepEqual(openingWindow(0), { start: 0, end: 0 });
  assert.deepEqual(openingWindow(Number.NaN), { start: 0, end: 0 });
});

test('a window can never run past the file', () => {
  const w = clampWindow(0, 60, 9.4);
  assert.equal(w.start, 0);
  assert.equal(w.end, 9.4);
});

test('a window can never be longer than 25 seconds', () => {
  const w = clampWindow(10, 60, 70);
  assert.equal(w.start, 10);
  assert.ok(w.end - w.start <= MOMENT_CLIP_SECONDS + 0.001, `got ${w.end - w.start}`);
});

test('a window is never empty', () => {
  const w = clampWindow(9.4, 9.4, 9.4);
  assert.ok(w.end > w.start, `${w.start}..${w.end}`);
});

test('a start past the end of the file is pulled back inside it', () => {
  const w = clampWindow(40, 50, 12);
  assert.ok(w.start < 12, String(w.start));
  assert.equal(w.end, 12);
});

test('the label reads minutes and seconds', () => {
  assert.equal(clipTimeLabel(25), '0:25');
  assert.equal(clipTimeLabel(0), '0:00');
  assert.equal(clipTimeLabel(65.9), '1:05');
  assert.equal(clipTimeLabel(Number.NaN), '0:00');
});
