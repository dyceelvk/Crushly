import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import worker from './index';
import release from './release.json';

test('unpublished secure channel fails closed and never points to the legacy APK', async () => {
  const response = await worker.fetch(new Request('https://media.test/secure/version'), {} as never, {} as never);
  assert.equal(response.status, 503);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.apkUrl, undefined);
  assert.equal(body.downloadInfoUrl, undefined);
  const legacy = await worker.fetch(new Request('https://media.test/version'), {} as never, {} as never);
  assert.equal(legacy.status, 200);
  // Read from `release.json`, never a number typed into a test: the legacy
  // channel's job is to serve whatever the file says, and a hardcoded 87 turned
  // "we published 1.0.95" into a red build for no reason.
  assert.equal((await legacy.json() as Record<string, unknown>).versionCode, release.versionCode);
});
