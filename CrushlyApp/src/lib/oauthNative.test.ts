import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isNativeReturn, NATIVE_REDIRECT, nativeAuthorizeUrl, parseNativeReturn } from './oauthNative';

test('the authorize address names the provider and the way home', () => {
  const url = nativeAuthorizeUrl('https://abcd.supabase.co/');
  assert.equal(
    url,
    'https://abcd.supabase.co/auth/v1/authorize?provider=google&redirect_to=crushly%3A%2F%2Fauth-callback',
  );
  assert.equal(NATIVE_REDIRECT, 'crushly://auth-callback');
});

test('a session comes back from the fragment, as Supabase sends it', () => {
  const back = parseNativeReturn(
    'crushly://auth-callback#access_token=at123&expires_in=3600&refresh_token=rt456&token_type=bearer&type=magiclink',
  );
  assert.deepEqual(back, { kind: 'session', accessToken: 'at123', refreshToken: 'rt456' });
});

test('a session is also read when it arrives in the query', () => {
  assert.deepEqual(
    parseNativeReturn('crushly://auth-callback?access_token=at&refresh_token=rt'),
    { kind: 'session', accessToken: 'at', refreshToken: 'rt' },
  );
});

test('a half session is refused, not adopted', () => {
  // An access token alone signs somebody in for an hour and then drops them out.
  const half = parseNativeReturn('crushly://auth-callback#access_token=at');
  assert.equal(half?.kind, 'error');
});

test('a cancelled consent screen says it was cancelled', () => {
  const back = parseNativeReturn('crushly://auth-callback?error=access_denied&error_description=The+user+denied');
  assert.deepEqual(back, { kind: 'error', message: 'Google sign-in was cancelled.' });
});

test('another provider failure is reported with its reason cleaned up', () => {
  const back = parseNativeReturn('crushly://auth-callback?error=server_error&error_description=Provider+is+not+enabled');
  assert.equal(back?.kind, 'error');
  assert.match((back as { message: string }).message, /Provider is not enabled/);
});

test('an address of ours with nothing in it is an error, not silence', () => {
  assert.equal(parseNativeReturn('crushly://auth-callback')?.kind, 'error');
});

test('links that are not our return are ignored entirely', () => {
  // Some other deep link must never be read as a failed sign-in.
  assert.equal(parseNativeReturn('crushly://post/12'), null);
  assert.equal(parseNativeReturn('https://www.holupp.net/app'), null);
  assert.equal(parseNativeReturn(''), null);
  assert.equal(parseNativeReturn(undefined), null);
  assert.equal(isNativeReturn('crushly://post/12'), false);
  assert.equal(isNativeReturn('crushly://auth-callback?x=1'), true);
});
