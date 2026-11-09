import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spaceShareUrl, sharedSpaceId } from './spaceShare';

test('Space links round trip only through trusted hosts and valid ids', () => {
  assert.equal(sharedSpaceId(spaceShareUrl(42)), 42);
  assert.equal(sharedSpaceId('https://evil.example/?space=42'), null);
  assert.equal(sharedSpaceId('https://holupapp.vercel.app/?space=0'), null);
  assert.equal(sharedSpaceId('https://holupapp.vercel.app/?space=1foo'), null);
  assert.throws(() => spaceShareUrl(-1));
});
