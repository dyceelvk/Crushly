/**
 * Where the APK is served from, and what happens when the place it lives says no.
 *
 * The channel broke in a way worth keeping as a test. `/version` advertised
 * 1.0.96 happily — it reads `release.json` — while `/download` answered 503,
 * because the file was streamed out of B2 and the account's download allowance
 * had run out. A phone saw "update available", fetched nothing, and retried.
 *
 * So: R2 first (no egress bill, same account as the Worker), B2 as the fallback,
 * and a size check against `release.json` before any byte is sent, whichever
 * source answers. These tests stand in for both services; none of them need a
 * network.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import worker from './index';
import release from './release.json';

const KEY = `android-releases/${release.file}`;

/** Bytes shaped like an APK, only as long as `release.json` says. */
function fakeApk(): Uint8Array {
  const bytes = new Uint8Array(release.bytes);
  bytes.set([0x50, 0x4b, 0x03, 0x04], 0); // PK\x03\x04 — the app's own check
  return bytes;
}

const asBody = (bytes: Uint8Array) =>
  new Response(bytes).body as unknown as ReadableStream;

/** A bucket that holds (or does not hold) one object. */
function bucketWith(size: number | null) {
  const bytes = fakeApk();
  const object = size === null ? null : { size, body: asBody(bytes) };
  return {
    head: async (key: string) => (key === KEY && object ? { size } : null),
    get: async (key: string) => (key === KEY ? object : null),
  };
}

const get = (path = '/download') => new Request(`https://media.test${path}`, { headers: { Origin: 'https://holupapp.vercel.app' } });

test('the release is served from R2 without touching B2', async () => {
  const env = { RELEASES: bucketWith(release.bytes) } as never;
  const res = await worker.fetch(get(), env, {} as never);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/vnd.android.package-archive');
  assert.equal(res.headers.get('content-length'), String(release.bytes));
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.match(res.headers.get('content-disposition') ?? '', /Crushly-.*\.apk/);
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.equal(bytes.length, release.bytes);
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
});

test('a HEAD on R2 answers with the advertised length and no body', async () => {
  const env = { RELEASES: bucketWith(release.bytes) } as never;
  const res = await worker.fetch(new Request('https://media.test/download', { method: 'HEAD' }), env, {} as never);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-length'), String(release.bytes));
  assert.equal(await res.text(), '');
});

test('the download is readable from another origin', async () => {
  const env = { RELEASES: bucketWith(release.bytes) } as never;
  const res = await worker.fetch(get(), env, {} as never);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://holupapp.vercel.app');
});

test('an object of the wrong size is refused rather than served', async () => {
  // This is the failure the app itself would catch; the Worker must not be the
  // one to send it. With no B2 credentials configured there is nothing to fall
  // back to, so the answer is the honest 503.
  const env = { RELEASES: bucketWith(release.bytes - 1) } as never;
  const res = await worker.fetch(get(), env, {} as never);
  assert.equal(res.status, 503);
  const body = (await res.json()) as Record<string, unknown>;
  assert.match(String(body.error), /temporarily unavailable/i);
});

test('a missing object falls through to the mirror, and a mirror with no credentials says so', async () => {
  const env = { RELEASES: bucketWith(null) } as never;
  const res = await worker.fetch(get(), env, {} as never);
  assert.equal(res.status, 503);
});

test('a Worker deployed before the bucket existed still answers', async () => {
  const res = await worker.fetch(get(), {} as never, {} as never);
  assert.equal(res.status, 503);
});

test('/version keeps advertising the build the release file describes', async () => {
  const res = await worker.fetch(new Request('https://media.test/version'), {} as never, {} as never);
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.version, release.version);
  assert.equal(body.versionCode, release.versionCode);
  assert.equal(body.bytes, release.bytes);
  assert.equal(body.sha256, release.sha256);
});
