/**
 * Saving a clip to the device: where the marked copy is looked for.
 *
 * The bug this pins: `/d/<post id>` asked **B2 only**, while every upload since
 * media moved to R2 is written to **R2**. So the marked copy existed, the
 * database pointed straight at it, and the endpoint answered 404 — which the app
 * could only show as "that clip isn't available to save". Every clip posted after
 * the move was unsaveable.
 *
 * These tests stand in for both stores and for the database; nothing here needs
 * a network.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import worker from './index';

const PATH = 'posts/3/1763000000-marked.mp4';
const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]); // ftyp…

const asBody = () => new Response(MP4).body as unknown as ReadableStream;

/** An R2-shaped bucket holding (or not holding) one path. */
function mediaBucket(holds: boolean) {
  return {
    get: async (key: string) => (holds && key === PATH ? { size: MP4.length, body: asBody(), httpMetadata: { contentType: 'video/mp4' } } : null),
    put: async () => undefined,
    delete: async () => undefined,
  };
}

/**
 * The database answer for `post_download`, and nothing else.
 *
 * B2 authentication is left to fail: every case below is decided before it, and a
 * test that quietly reached a real bucket would be worse than one that does not.
 */
function stubDatabase(path: string | null) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/rest/v1/rpc/post_download')) {
      return new Response(JSON.stringify(path ? { path } : null), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error('unexpected network call: ' + url);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

const save = () =>
  new Request('https://media.test/d/3', { headers: { Authorization: 'Bearer session-token' } });

test('a marked copy in R2 is served — the store uploads actually write to', async () => {
  const restore = stubDatabase(PATH);
  try {
    const env = { SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon', MEDIA: mediaBucket(true) } as never;
    const res = await worker.fetch(save(), env, {} as never);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-disposition'), 'attachment; filename="holup-3.mp4"');
    assert.equal(res.headers.get('content-type'), 'video/mp4');
    assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [...MP4]);
  } finally {
    restore();
  }
});

test('a post with no marked copy says so, in words a member can act on', async () => {
  const restore = stubDatabase(PATH);
  try {
    const env = { SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon', MEDIA: mediaBucket(false) } as never;
    const res = await worker.fetch(save(), env, {} as never);
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error?: string };
    // Not "sign in again" and not a bare refusal: the copy is simply not made yet.
    assert.match(body.error ?? '', /isn’t ready yet/i);
  } finally {
    restore();
  }
});

test('a post the member may not see is refused the same way, without leaking', async () => {
  const restore = stubDatabase(null);
  try {
    const env = { SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon', MEDIA: mediaBucket(true) } as never;
    const res = await worker.fetch(save(), env, {} as never);
    assert.equal(res.status, 404);
  } finally {
    restore();
  }
});

test('no token at all is a sign-in problem, not a missing clip', async () => {
  const env = { SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon', MEDIA: mediaBucket(true) } as never;
  const res = await worker.fetch(new Request('https://media.test/d/3'), env, {} as never);
  assert.equal(res.status, 401);
});
