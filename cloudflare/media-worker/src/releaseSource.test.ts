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
  // Whatever release.json names, not a name typed here: the file is called
  // holUpp-<version>-RielOS.apk now, and the Worker's job is to serve the name
  // it was given.
  assert.match(res.headers.get('content-disposition') ?? '', /filename="[^"]+\.apk"/);
  assert.ok((res.headers.get('content-disposition') ?? '').includes(release.file));
  // Which store answered, so "is R2 really doing the work?" is answerable from
  // a terminal instead of inferred.
  assert.equal(res.headers.get('x-holup-release-source'), 'r2');
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

/** Run `body` with every outbound fetch failing, so no fallback can quietly work. */
async function offline<T>(body: () => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as typeof fetch;
  try {
    return await body();
  } finally {
    globalThis.fetch = realFetch;
  }
}

test('an object of the wrong size is refused rather than served', async () => {
  // The failure the app itself would catch; the Worker must not be the one to
  // send it. With every other source unreachable the answer is the honest 503.
  const res = await offline(() => worker.fetch(get(), { RELEASES: bucketWith(release.bytes - 1) } as never, {} as never));
  assert.equal(res.status, 503);
  const body = (await res.json()) as Record<string, unknown>;
  assert.match(String(body.error), /temporarily unavailable/i);
});

test('a missing object falls through to the next source rather than failing', async () => {
  const res = await offline(() => worker.fetch(get(), { RELEASES: bucketWith(null) } as never, {} as never));
  // Both the bucket and the public channel were unreachable here, so this is the
  // end of the line — what matters is that it answered instead of throwing.
  assert.equal(res.status, 503);
});

test('a Worker deployed before the bucket existed still answers', async () => {
  const res = await offline(() => worker.fetch(get(), {} as never, {} as never));
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

/* ------------------------------------------------ the public release channel */

test('with no bucket bound, the APK comes from the public release channel', async () => {
  // The shape of the world right now: R2 not subscribed, B2 capped out, and a
  // public release asset that anybody can fetch. The Worker asks it for the file
  // and re-serves it, so the app keeps one stable URL.
  const realFetch = globalThis.fetch;
  let asked: string | null = null;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    asked = String(input);
    if (!asked.includes('holupp-releases')) return new Response('nope', { status: 404 });
    return new Response(fakeApk(), { headers: { 'content-length': String(release.bytes) } });
  }) as typeof fetch;
  try {
    const res = await worker.fetch(get(), {} as never, {} as never);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-length'), String(release.bytes));
    assert.equal(res.headers.get('content-type'), 'application/vnd.android.package-archive');
    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.equal(bytes.length, release.bytes);
    assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
    assert.match(String(asked), /holupp-releases/);
    assert.equal(res.headers.get('x-holup-release-source'), 'public');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a public copy of the wrong length is not served', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(new Uint8Array(16), { headers: { 'content-length': '16' } })) as typeof fetch;
  try {
    const res = await worker.fetch(get(), {} as never, {} as never);
    assert.equal(res.status, 503);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('R2 wins when it is bound, so the public channel is only the fallback', async () => {
  const realFetch = globalThis.fetch;
  let asked = false;
  globalThis.fetch = (async () => { asked = true; return new Response('should not be called', { status: 500 }); }) as typeof fetch;
  try {
    const res = await worker.fetch(get(), { RELEASES: bucketWith(release.bytes) } as never, {} as never);
    assert.equal(res.status, 200);
    assert.equal(asked, false, 'the public channel must not be touched while R2 answers');
  } finally {
    globalThis.fetch = realFetch;
  }
});
