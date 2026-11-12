/**
 * The signed release identity asks at /secure/version and must get a real answer.
 *
 * This endpoint used to answer 503 "not available yet", which was honest while
 * the only published file was a differently-signed debug build: offering that
 * to a signed install is worse than offering nothing. But the build we ship is
 * now the secure identity's own (app.holup.mobile), so the refusal stopped being
 * caution and became the bug — the app checked, was refused, and stayed on its
 * old version with nothing said. Both channels now describe the one build in
 * release.json, and neither may ever point at a package it does not match.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './index';
import release from './release.json' with { type: 'json' };

test('the secure channel serves the published build, and both channels agree', async () => {
  const secure = await worker.fetch(new Request('https://media.test/secure/version'), {} as never, {} as never);
  assert.equal(secure.status, 200);
  const body = await secure.json() as Record<string, unknown>;
  assert.equal(body.version, release.version);
  assert.equal(body.versionCode, release.versionCode);
  assert.equal(body.sha256, release.sha256);
  // The file it offers is the one this build records, and it is fetched through
  // our own resolver — never a link into the release bucket or GitHub.
  assert.equal(body.apkUrl, 'https://media.test/download');
  assert.equal(body.downloadInfoUrl, 'https://media.test/download-info');

  const legacy = await worker.fetch(new Request('https://media.test/version'), {} as never, {} as never);
  assert.equal(legacy.status, 200);
  const legacyBody = await legacy.json() as Record<string, unknown>;
  // Read from `release.json`, never a number typed into a test: a hardcoded 87
  // turned "we published 1.0.95" into a red build for no reason.
  assert.equal(legacyBody.versionCode, release.versionCode);
  assert.deepEqual(legacyBody, body);
});

test('/secure/version refuses methods that are not a read', async () => {
  const response = await worker.fetch(new Request('https://media.test/secure/version', { method: 'POST' }), {} as never, {} as never);
  assert.equal(response.status, 405);
});
