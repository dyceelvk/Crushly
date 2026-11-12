import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validId, renderShare, renderUnavailableShare, originOf } from '../api/post-share.mjs';
test('rejects malformed and unsafe post ids', () => {
  for (const id of ['', '0', '-1', '1x', '1/2', '9007199254740993']) assert.equal(validId(id), false);
  assert.equal(validId('123'), true);
});
test('escapes user content and includes copyable canonical and OG tags', () => {
  const html = renderShare({id: 123, author: '<script>', body: '" onmouseover="x & <img>'});
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img>'));
  assert.ok(html.includes('https://holupp.net/v/123'));
  assert.ok(html.includes('property="og:description"'));
  assert.ok(html.includes('name="twitter:card"'));
  // A messenger renders a card, not a page: every field one needs is present.
  assert.ok(html.includes('property="og:site_name" content="holUpp"'));
  assert.ok(html.includes('property="og:image:width" content="1200"'));
  assert.ok(html.includes('property="og:image:height" content="630"'));
  assert.ok(html.includes('property="og:image:alt"'));
  assert.ok(html.includes('name="twitter:image:alt"'));
  // Reachable by link, not listed by a search engine. `follow` keeps the
  // links on the page crawlable; messengers ignore this tag, so cards still
  // unfurl. A private post never becomes indexable by being requested.
  assert.ok(html.includes('<meta name="robots" content="noindex, follow">'));
  assert.ok(html.includes('og:image" content="https://holupp.net/brand/share-card.png"'));
  assert.ok(html.includes(`<link rel="canonical" href="https://holupp.net/v/123">`));
  // Both installs can open the post: the secure scheme first, the older one
  // still offered rather than silently dropped.
  assert.ok(html.includes('href="holup://v/123"'));
  assert.ok(html.includes('href="crushly://v/123"'));
});

test('a card on the new domain advertises the new domain, and an old link keeps its own', () => {
  const post = { id: 123, author: 'Ada', body: 'Hello' };
  // Served by the domain we publish.
  assert.equal(originOf({ headers: { host: 'holupp.net' } }), 'https://holupp.net');
  assert.equal(originOf({ headers: { host: 'www.holupp.net' } }), 'https://www.holupp.net');
  assert.ok(renderShare(post, null, 'https://holupp.net').includes('content="https://holupp.net/v/123"'));
  // A link shared before the domain existed still unfurls, pointing at itself,
  // rather than quietly sending the reader somewhere that does not resolve yet.
  assert.equal(originOf({ headers: { host: 'holupapp.vercel.app' } }), 'https://holupapp.vercel.app');
  assert.ok(renderShare(post, null, 'https://holupapp.vercel.app').includes('content="https://holupapp.vercel.app/v/123"'));
  // Any other Host header is not echoed back into the page.
  assert.equal(originOf({ headers: { host: 'evil.example' } }), 'https://holupp.net');
  assert.equal(originOf({}), 'https://holupp.net');
  // Default output is the canonical site.
  assert.ok(renderShare(post).includes('content="https://holupp.net/v/123"'));
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
  assert.match(html, /href="holup:\/\/v\/123"/);
  assert.match(html, /href="crushly:\/\/v\/123"/);
  assert.doesNotMatch(html, /og:description|og:image/);
  assert.doesNotMatch(renderUnavailableShare('1\"<script>', 'sb-project-auth-token'), /<script>/);
});
