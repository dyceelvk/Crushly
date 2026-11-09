import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validId, renderShare, renderUnavailableShare } from '../api/post-share.mjs';
test('rejects malformed and unsafe post ids', () => {
  for (const id of ['', '0', '-1', '1x', '1/2', '9007199254740993']) assert.equal(validId(id), false);
  assert.equal(validId('123'), true);
});
test('escapes user content and includes copyable canonical and OG tags', () => {
  const html = renderShare({id: 123, author: '<script>', body: '" onmouseover="x & <img>'});
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img>'));
  assert.ok(html.includes('https://holupapp.vercel.app/v/123'));
  assert.ok(html.includes('property="og:description"'));
  assert.ok(html.includes('name="twitter:card"'));
});

test('landing rechecks visibility every time and never caches restricted posts', async () => {
  const { default: handler } = await import('../api/post-share.mjs');
  const original = globalThis.fetch;
  const oldBase = process.env.EXPO_PUBLIC_SUPABASE_URL, oldKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.test'; process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-public';
  let visible = true;
  globalThis.fetch = async () => new Response(JSON.stringify(visible ? { id: 123, author: 'Ada', body: 'Hello' } : null), { status: 200 });
  const makeRes = () => ({ headers: {}, statusCode: 0, value: '', setHeader(k,v) { this.headers[k] = v; }, status(s) { this.statusCode = s; return this; }, send(v) { this.value = v; return this; } });
  try {
    const first = makeRes(); await handler({ method: 'GET', query: { id: '123' } }, first);
    assert.equal(first.statusCode, 200); assert.match(first.value, /Hello/); assert.match(first.headers['Cache-Control'], /no-store/);
    visible = false;
    const revoked = makeRes(); await handler({ method: 'GET', query: { id: '123' } }, revoked);
    assert.equal(revoked.statusCode, 404); assert.doesNotMatch(revoked.value, /Hello/);
    globalThis.fetch = async () => new Response('', { status: 503 });
    const unavailable = makeRes(); await handler({ method: 'GET', query: { id: '123' } }, unavailable);
    assert.equal(unavailable.statusCode, 503);
  } finally {
    globalThis.fetch = original;
    if (oldBase === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL; else process.env.EXPO_PUBLIC_SUPABASE_URL = oldBase;
    if (oldKey === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY; else process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = oldKey;
  }
});

test('browser handoff only uses a validated storage key, without leaking it to the server', () => {
  const post = {id: 123, author: 'Ada', body: 'Hello'};
  const html = renderShare(post, 'sb-project-ref-auth-token');
  assert.match(html, /localStorage.getItem\("sb-project-ref-auth-token"\)/);
  assert.match(html, /location.replace\('\/\?post=123'\)/);
  assert.doesNotMatch(renderShare(post, '</script><script>bad'), /localStorage/);
});
test('unavailable targets have a generic non-leaking sign-in handoff', () => {
  const html = renderUnavailableShare('123', 'sb-project-ref-auth-token');
  assert.match(html, /location.replace\('\/\?post=123'\)/);
  assert.match(html, /name="robots" content="noindex"/);
  assert.doesNotMatch(html, /og:description|og:image/);
  assert.doesNotMatch(renderUnavailableShare('1\"<script>', 'sb-project-auth-token'), /<script>/);
});
