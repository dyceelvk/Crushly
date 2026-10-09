import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserLocation } from './browser';
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
