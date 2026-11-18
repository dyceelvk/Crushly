import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderProfile, renderUnavailableProfile, originOf } from '../api/profile-share.mjs';

test('a Space card carries what a messenger needs, and escapes what the member typed', () => {
  const html = renderProfile({ username: 'joma', name: '<script>x</script>', bio: '" onload="evil', age: 27, city: 'Lagos', verified: true });
  assert.ok(!html.includes('<script>x</script>'));
  assert.ok(!html.includes('onload="evil'));
  assert.ok(html.includes('https://holupp.net/u/joma'));
  assert.ok(html.includes('property="og:type" content="profile"'));
  assert.ok(html.includes('property="og:site_name" content="holUpp"'));
  assert.ok(html.includes('name="twitter:card" content="summary_large_image"'));
  assert.ok(html.includes('<link rel="canonical" href="https://holupp.net/u/joma">'));
  // Reachable by link, never listed by a search engine.
  assert.ok(html.includes('<meta name="robots" content="noindex, follow">'));
  // Both installs can open it.
  assert.ok(html.includes('href="holup://space/joma"'));
  assert.ok(html.includes('href="crushly://space/joma"'));
});

test('a hidden Space says nothing about why it is hidden', () => {
  const hidden = renderUnavailableProfile('joma');
  // No id, no name, no hint of whether the member exists.
  assert.ok(!hidden.includes('og:title'));
  assert.ok(!hidden.includes('@joma'));
  assert.ok(hidden.includes('noindex'));
});

test('the card advertises the host it was served on', () => {
  assert.equal(originOf({ headers: { host: 'holupp.net' } }), 'https://holupp.net');
  assert.equal(originOf({ headers: { host: 'holupapp.vercel.app' } }), 'https://holupapp.vercel.app');
  assert.equal(originOf({ headers: { host: 'evil.example' } }), 'https://holupp.net');
  assert.ok(renderProfile({ username: 'joma' }, null, 'https://www.holupp.net').includes('content="https://www.holupp.net/u/joma"'));
});

test('a member with no bio still produces a real description', () => {
  const html = renderProfile({ username: 'joma', name: 'Joma', age: 27, city: 'Lagos' });
  assert.ok(html.includes('27 · Lagos'));
  assert.ok(renderProfile({ username: 'joma' }).includes('See @joma on holUpp'));
});
