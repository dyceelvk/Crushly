import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import worker, { type Env } from './index';
import deployment from './deployment.json';

const env: Env = {
  SUPABASE_URL: 'https://project.example', SUPABASE_ANON_KEY: 'public-key',
  B2_KEY_ID: 'key-id', B2_APPLICATION_KEY: 'application-key', B2_BUCKET: 'media',
};
const context = { waitUntil() {} } as any;
const request = (path: string, method = 'GET') => new Request(`https://worker.example${path}`, {
  method, headers: { Authorization: 'Bearer test-member', Origin: 'https://app.example' },
});

function transport(t: TestContext, { allowed = true, deleteOk = true } = {}) {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: 'member' });
    if (url.includes('/rpc/can_view_media')) return Response.json({ allowed, cacheable: true });
    if (url.includes('/rpc/can_manage_media')) {
      assert.deepEqual(JSON.parse(String(init?.body)), {
        p_path: 'photos/1/a.jpg', p_url: 'https://worker.example/m/photos/1/a.jpg',
      });
      return Response.json(allowed);
    }
    if (url.includes('/storage/v1/object/authenticated/media/')) {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('Authorization'), 'Bearer test-member');
      assert.equal(headers.get('apikey'), 'public-key');
      return new Response('legacy bytes', { headers: { 'Content-Type': 'image/jpeg' } });
    }
    if (url.includes('b2_authorize_account')) return Response.json({
      authorizationToken: 'b2-token', apiUrl: 'https://b2-api.example',
      downloadUrl: 'https://b2-files.example', accountId: 'account',
    });
    if (url.includes('b2_list_buckets')) return Response.json({ buckets: [{
      bucketId: 'bucket', bucketName: 'media', bucketType: 'allPrivate', lifecycleRules: [],
    }] });
    if (url.startsWith('https://b2-files.example/file/')) return new Response('private bytes');
    if (url.includes('b2_list_file_versions')) return Response.json({ files: [{ fileName: 'photos/1/a.jpg', fileId: 'file' }] });
    if (url.includes('b2_delete_file_version')) return new Response(null, { status: deleteOk ? 200 : 503 });
    throw new Error(`Unexpected external call: ${url}`);
  });
  return calls;
}

test('authorized media is no-store, including formerly cacheable photos', async (t) => {
  transport(t);
  const res = await worker.fetch(request('/m/photos/1/a.jpg'), env, context);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://app.example');
  assert.equal(await res.text(), 'private bytes');
});

test('revoked media is denied before fetching file bytes', async (t) => {
  const calls = transport(t, { allowed: false });
  const res = await worker.fetch(request('/m/photos/1/a.jpg'), env, context);
  assert.equal(res.status, 404);
  assert.ok(calls.every((url) => !url.includes('b2-')));
});

test('legacy media is read with the member JWT, never a public or B2 URL', async (t) => {
  const calls = transport(t);
  const res = await worker.fetch(request('/legacy/photos/1/a.jpg'), env, context);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'legacy bytes');
  assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
  assert.ok(calls.some((url) => url.includes('/storage/v1/object/authenticated/media/photos/1/a.jpg')));
  assert.ok(calls.every((url) => !url.includes('b2-')));
});

test('legacy route never accepts new uploads', async (t) => {
  transport(t);
  const res = await worker.fetch(request('/legacy/messages/1/a.jpg', 'POST'), env, context);
  assert.equal(res.status, 405);
});

test('B2 deletion failures are not reported as success', async (t) => {
  transport(t, { deleteOk: false });
  const res = await worker.fetch(request('/m/photos/1/a.jpg', 'DELETE'), env, context);
  assert.equal(res.status, 502);
});

test('owned deletion uses the canonical Worker URL', async (t) => {
  transport(t);
  const res = await worker.fetch(request('/m/photos/1/a.jpg', 'DELETE'), env, context);
  assert.equal(res.status, 200);
});

test('cross-owner deletion is denied before B2', async (t) => {
  const calls = transport(t, { allowed: false });
  const res = await worker.fetch(request('/m/photos/1/a.jpg', 'DELETE'), env, context);
  assert.equal(res.status, 404);
  assert.ok(calls.every((url) => !url.includes('b2-')));
});

test('bad URL escapes and encoded path traversal are refused', async () => {
  assert.equal((await worker.fetch(request('/m/%xx'), env, context)).status, 400);
  assert.equal((await worker.fetch(request('/legacy/photos/1/%2e%2e%2Fsecret'), env, context)).status, 400);
});

test('deployment provenance is public, minimal and never cached', async () => {
  const res = await worker.fetch(new Request('https://worker.example/deployment'), env, context);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await res.json(), deployment);
});
