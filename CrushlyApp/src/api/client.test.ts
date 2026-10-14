import { test } from 'node:test';
import assert from 'node:assert/strict';

// Exercise the actual client orchestration without loading native modules or
// making a network call. Each Node test file has its own module process.
const fakeStorage = { uploads: [] as string[], uploadError: null as unknown };
const fakeClient = {
  auth: {
    getSession: async () => ({ data: { session: { access_token: 'member-token' } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
  storage: {
    from: (bucket: string) => ({
      upload: async () => {
        fakeStorage.uploads.push(bucket);
        return { error: fakeStorage.uploadError };
      },
    }),
  },
};
function stub(id: string, exports: unknown) {
  const filename = require.resolve(id);
  require.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeModule;
}
stub('react-native', { Platform: { OS: 'web' } });
stub('../lib/storage', { storage: {} });
stub('@supabase/supabase-js', { createClient: () => fakeClient });
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'public-test-key';
process.env.EXPO_PUBLIC_MEDIA_BASE_URL = 'https://worker.example';
process.env.EXPO_PUBLIC_MEDIA_KINDS = 'photos,moments,messages,posts,circles,vibes';
const client = require('./client') as typeof import('./client');

for (const status of [401, 403, 413, 429, 502]) {
  test(`Worker ${status} never falls back to Supabase media`, async (t) => {
    fakeStorage.uploads = [];
    t.mock.method(globalThis, 'fetch', async (url: string) => {
      if (url === 'blob:local') return new Response('file');
      return new Response(JSON.stringify({ error: 'Private upload refused' }), { status });
    });
    await assert.rejects(client.uploadMediaFile('media', 'messages/1/file.jpg', 'blob:local', 'image/jpeg'),
      (error: unknown) => error instanceof client.ApiError && error.status === status);
    assert.deepEqual(fakeStorage.uploads, []);
  });
}

test('network failure is surfaced without public fallback', async (t) => {
  fakeStorage.uploads = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url === 'blob:local') return new Response('file');
    throw new TypeError('network down');
  });
  await assert.rejects(client.uploadMediaFile('media', 'moments/1/file.jpg', 'blob:local', 'image/jpeg'));
  assert.deepEqual(fakeStorage.uploads, []);
});

test('Vibes upload through the private Worker with the correct kind', async (t) => {
  fakeStorage.uploads = [];
  t.mock.method(globalThis, 'fetch', async (url: string, options?: RequestInit) => {
    if (url === 'blob:local') return new Response('clip');
    assert.equal(url, 'https://worker.example/m');
    const headers = new Headers(options?.headers);
    assert.equal(headers.get('X-Media-Kind'), 'vibes');
    assert.equal(headers.get('Authorization'), 'Bearer member-token');
    return Response.json({ url: 'https://worker.example/m/vibes/1/clip.mp4' });
  });
  assert.equal(await client.uploadMediaFile('media', 'vibes/1/clip.mp4', 'blob:local', 'video/mp4'),
    'https://worker.example/m/vibes/1/clip.mp4');
  assert.deepEqual(fakeStorage.uploads, []);
});

test('unknown member media kinds fail closed but private verification uploads work', async (t) => {
  fakeStorage.uploads = [];
  t.mock.method(globalThis, 'fetch', async () => new Response('file'));
  await assert.rejects(client.uploadMediaFile('media', 'unknown/1/a.jpg', 'blob:local', 'image/jpeg'));
  assert.deepEqual(fakeStorage.uploads, []);
  await client.uploadMediaFile('verification', 'selfies/1/a.jpg', 'blob:local', 'image/jpeg');
  assert.deepEqual(fakeStorage.uploads, ['verification']);
});

test('legacy paths/URLs keep their store and new Worker URLs stay unchanged', () => {
  assert.equal(client.mediaUrl('photos/1/a.jpg'), 'https://worker.example/legacy/photos/1/a.jpg');
  assert.equal(client.mediaUrl('seed/demo.jpg'), 'https://worker.example/legacy/seed/demo.jpg');
  assert.equal(client.mediaUrl('https://project.supabase.co/storage/v1/object/public/media/messages/1/a.jpg'),
    'https://worker.example/legacy/messages/1/a.jpg');
  assert.equal(client.mediaUrl('https://worker.example/m/vibes/1/a.mp4'), 'https://worker.example/m/vibes/1/a.mp4');
});
