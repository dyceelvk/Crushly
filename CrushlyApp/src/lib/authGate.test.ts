import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authStatus } from './authGate';

const base = { restoring: false, signedIn: true, mustSetPassword: false };

test('the ordinary case opens the app', () => {
  assert.equal(authStatus({ ...base, me: { onboarded: true, needsBirthdate: false } }), 'ready');
});

test('a profile with no birthday is asked for one, not assumed', () => {
  // Onboarded, everything filled in, but the birthday was never given. The age
  // gate cannot judge it, so the only honest door is onboarding.
  assert.equal(authStatus({ ...base, me: { onboarded: true, needsBirthdate: true } }), 'onboarding');
  assert.equal(authStatus({ ...base, me: { onboarded: false, needsBirthdate: false } }), 'onboarding');
});

test('the other doors still win in the right order', () => {
  const me = { onboarded: true, needsBirthdate: true };
  assert.equal(authStatus({ ...base, restoring: true, signedIn: false, me: null }), 'restoring');
  assert.equal(authStatus({ ...base, signedIn: false, me: null }), 'signedOut');
  assert.equal(authStatus({ ...base, mustSetPassword: true, me }), 'resetting');
});
