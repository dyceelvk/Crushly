import assert from 'node:assert/strict';
import test from 'node:test';
import { captchaEnabled, captchaFailureMessage, captchaPageUrl, captchaSiteKey, getCaptchaToken, isCaptchaError, setCaptchaSolver } from './captcha';

/**
 * The captcha helper is the thin part between "Supabase wants a token" and "the
 * widget produced one". These tests cover the two ways that goes wrong quietly:
 * a missing key, and a solver that resolves with nothing.
 */
test('with no site key the app behaves as if the check did not exist', async () => {
  delete process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY;
  assert.equal(captchaEnabled(), false);
  assert.equal(captchaSiteKey(), '');
  // Not an error: no token is the correct answer when nothing is configured.
  assert.equal(await getCaptchaToken(), undefined);
});

test('a configured key with no widget mounted says so instead of sending a blank request', async () => {
  process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY = '0x4AAAAAAAtestsitekey';
  setCaptchaSolver(null);
  await assert.rejects(() => getCaptchaToken(), /security check is not available/i);
});

test('an empty token from the solver is a failure, not a pass', async () => {
  process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY = '0x4AAAAAAAtestsitekey';
  setCaptchaSolver(async () => '   ');
  await assert.rejects(() => getCaptchaToken(), /did not complete/i);
});

test('a token is trimmed and handed back exactly once per call', async () => {
  process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY = '0x4AAAAAAAtestsitekey';
  let calls = 0;
  setCaptchaSolver(async () => {
    calls += 1;
    return ` token-${calls} `;
  });
  assert.equal(await getCaptchaToken(), 'token-1');
  assert.equal(await getCaptchaToken(), 'token-2');
});

test('the native page is built from the configured key and never from a secret', () => {
  process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY = '0x4AAAAAAAtestsitekey';
  assert.equal(captchaPageUrl(), 'https://holupp.net/captcha.html?sitekey=0x4AAAAAAAtestsitekey');
});

test('provider wording is never shown to a person', () => {
  const raw = 'captcha protection: request disallowed (no captcha_token found)';
  assert.equal(isCaptchaError(raw), true);
  const shown = captchaFailureMessage(raw);
  assert.ok(!/captcha/i.test(shown), `should not say "captcha": ${shown}`);
  assert.match(shown, /security check/i);
});
