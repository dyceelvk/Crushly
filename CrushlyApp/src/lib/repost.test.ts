import test from 'node:test';
import assert from 'node:assert/strict';
import { optimisticRepostCount, repostActionLabel, repostAttribution } from './repost';

test('repost presentation keeps original ownership language separate', () => {
  assert.equal(repostAttribution('Ada'), 'Ada reposted');
  assert.equal(repostAttribution('  '), 'Someone reposted');
  assert.equal(repostActionLabel(false), 'Repost to your profile');
  assert.equal(repostActionLabel(true), 'Undo Repost');
});

test('optimistic repost count changes once and never goes below zero', () => {
  assert.equal(optimisticRepostCount(4, false, true), 5);
  assert.equal(optimisticRepostCount(4, true, false), 3);
  assert.equal(optimisticRepostCount(4, false, false), 4);
  assert.equal(optimisticRepostCount(0, true, false), 0);
  assert.equal(optimisticRepostCount(undefined, false, true), 1);
});
