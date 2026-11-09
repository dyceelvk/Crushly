import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import worker from './index';

test('unpublished secure channel fails closed and never points to the legacy APK', async () => {
  const response = await worker.fetch(new Request('https://media.test/secure/version'), {} as never, {} as never);
  assert.equal(response.status, 503);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.apkUrl, undefined);
  assert.equal(body.downloadInfoUrl, undefined);
  const legacy = await worker.fetch(new Request('https://media.test/version'), {} as never, {} as never);
  assert.equal(legacy.status, 200);
  assert.equal((await legacy.json() as Record<string, unknown>).versionCode, 87);
});
