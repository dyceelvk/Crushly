import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserLocation, returnUrl } from './browser';
import { isVerificationReturn } from './verification';

test('React Native window=global without location cannot crash route selection', () => {
  const nativeWindow = {};
  for (const platform of ['android', 'ios']) {
    const location = browserLocation(platform, nativeWindow);
    const landing = !!location && (location.pathname === '/verification' || isVerificationReturn(location.search ?? ''));
    assert.equal(landing, false);
    assert.equal(/type=recovery/.test(location?.hash ?? ''), false);
    assert.equal(location?.origin, undefined);
  }
});
test('native ignores even browser-shaped window data', () => {
  assert.equal(browserLocation('android', { location: { pathname: '/verification' } }), undefined);
});
test('browser callbacks remain intact and server rendering is safe', () => {
  const location = { pathname: '/verification', search: '?didit=done', hash: '#type=recovery', origin: 'https://crushlyi.netlify.app' };
  assert.equal(browserLocation('web', { location }), location);
  assert.equal(browserLocation('web', undefined), undefined);
  assert.equal(browserLocation('web', {}), undefined);
});

test('an OAuth return names the page, not just the host', () => {
  // The app is at /app on a host whose root is the marketing site.
  assert.equal(returnUrl({ origin: 'https://www.holupp.net', pathname: '/app' }), 'https://www.holupp.net/app');
  // Deployments that serve the app at the root stay at the root.
  assert.equal(returnUrl({ origin: 'https://holupapp.vercel.app', pathname: '/' }), 'https://holupapp.vercel.app');
  // Trailing slashes and a missing pathname both behave.
  assert.equal(returnUrl({ origin: 'https://www.holupp.net', pathname: '/app/' }), 'https://www.holupp.net/app');
  assert.equal(returnUrl({ origin: 'https://www.holupp.net' }), 'https://www.holupp.net');
  // Nothing to say off the web.
  assert.equal(returnUrl(undefined), undefined);
});
