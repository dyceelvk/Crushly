import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCount } from './counts';

test('zero', () => {
  assert.equal(formatCount(0), '0');
});

test('a small count is shown honestly rather than shortened', () => {
  assert.equal(formatCount(84), '84');
  assert.equal(formatCount(2037), '2037');
});

test('the last unshortened number is 9999', () => {
  assert.equal(formatCount(9999), '9999');
});

test('ten thousand starts the shortened form', () => {
  assert.equal(formatCount(10_000), '10K');
});

test('a trailing .0 is dropped rather than shown as 12.0K', () => {
  assert.equal(formatCount(12_000), '12K');
});

test('a fractional thousands value keeps one decimal', () => {
  assert.equal(formatCount(12_400), '12.4K');
  assert.equal(formatCount(736_400), '736.4K');
});

test('millions are shortened with an M', () => {
  assert.equal(formatCount(2_500_000), '2.5M');
  assert.equal(formatCount(1_000_000), '1M');
});

test('fractions are floored, never rounded up into a wrong number', () => {
  assert.equal(formatCount(9999.9), '9999');
});

test('nonsense does not reach the screen as NaN', () => {
  assert.equal(formatCount(Number.NaN), '0');
  assert.equal(formatCount(-5), '0');
  assert.equal(formatCount(Number.POSITIVE_INFINITY), '0');
});
