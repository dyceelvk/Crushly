import { test } from 'node:test';
import assert from 'node:assert/strict';

import { newCallChannel } from './callChannel';

test('newCallChannel makes unguessable per-call channel names', () => {
  const a = newCallChannel();
  assert.match(a, /^call-[a-z0-9]+-[a-z0-9]{16}$/);
  assert.ok(a.length > 20);
});

test('newCallChannel never repeats', () => {
  const names = new Set(Array.from({ length: 500 }, () => newCallChannel()));
  assert.equal(names.size, 500);
});
