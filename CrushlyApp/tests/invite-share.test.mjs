import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderInvalidInvite, renderInvite, validCode, originOf } from '../api/invite-share.mjs';

const CODE = 'a1b2c3d4e5f60123456789abcdef0123';

test('invitation landing validates opaque codes and renders a browser fallback', () => {
  assert.equal(validCode(CODE), true);
  assert.equal(validCode('42'), false);
  const html = renderInvite(CODE, '<script>x</script>');
  assert.ok(!html.includes('<script>x</script>'));
  assert.ok(html.includes(`https://holupp.net/i/${CODE}`));
  assert.ok(html.includes(`/app?ref=${CODE}`));
  assert.ok(html.includes(`holup://invite/${CODE}`));
  assert.ok(html.includes(`crushly://invite/${CODE}`));
  assert.ok(html.includes('noindex, follow'));
  assert.ok(html.includes('counted only after the new member confirms'));
});

test('invalid invitations do not leak a person or an internal code', () => {
  const html = renderInvalidInvite();
  assert.ok(!html.includes('og:title'));
  assert.ok(!html.includes('@'));
  assert.ok(html.includes('noindex'));
});

test('landing pages only echo a known HolUpp host', () => {
  assert.equal(originOf({ headers: { host: 'holupp.net' } }), 'https://holupp.net');
  assert.equal(originOf({ headers: { host: 'www.holupp.net' } }), 'https://www.holupp.net');
  assert.equal(originOf({ headers: { host: 'evil.example' } }), 'https://holupp.net');
});

test('signed-in browser handoff validates the storage key', () => {
  assert.match(renderInvite(CODE, 'Ada', 'sb-project-ref-auth-token'), /localStorage\.getItem\("sb-project-ref-auth-token"\)/);
  assert.ok(renderInvite(CODE, 'Ada', 'sb-project-ref-auth-token').includes(`location.replace('/app?ref=${CODE}')`));
  assert.doesNotMatch(renderInvite(CODE, 'Ada', '</script><script>bad'), /localStorage/);
});

test('handler rechecks the server preview and never caches the result', async () => {
  const { default: handler } = await import('../api/invite-share.mjs');
  const original = globalThis.fetch;
  const oldBase = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const oldKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.test';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'public-test';
  let valid = true;
  globalThis.fetch = async () => new Response(JSON.stringify(valid ? { valid: true, inviterName: 'Ada' } : { valid: false }), { status: 200 });
  const makeRes = () => ({ headers: {}, statusCode: 0, value: '', setHeader(k, v) { this.headers[k] = v; }, status(s) { this.statusCode = s; return this; }, send(v) { this.value = v; return this; } });
  try {
    const first = makeRes();
    await handler({ method: 'GET', query: { id: CODE } }, first);
    assert.equal(first.statusCode, 200);
    assert.match(first.value, /Ada invited you/);
    assert.match(first.headers['Cache-Control'], /no-store/);
    valid = false;
    const second = makeRes();
    await handler({ method: 'GET', query: { id: CODE } }, second);
    assert.equal(second.statusCode, 404);
    assert.doesNotMatch(second.value, /Ada invited you/);
  } finally {
    globalThis.fetch = original;
    if (oldBase === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL; else process.env.EXPO_PUBLIC_SUPABASE_URL = oldBase;
    if (oldKey === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY; else process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = oldKey;
  }
});
