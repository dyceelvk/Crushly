import assert from 'node:assert/strict';
import test from 'node:test';
import { invitationUrl, sharedReferralCode } from './referral';

const CODE = 'a1b2c3d4e5f60123456789abcdef0123';

test('invitation links are canonical opaque HTTPS links', () => {
  assert.equal(invitationUrl(CODE.toUpperCase()), `https://holupp.net/i/${CODE}`);
  assert.throws(() => invitationUrl('42'));
  assert.throws(() => invitationUrl('z'.repeat(32)));
});

test('HTTPS and app links preserve the same referral code', () => {
  assert.equal(sharedReferralCode(`https://holupp.net/i/${CODE}`), CODE);
  assert.equal(sharedReferralCode(`https://www.holupp.net/i/${CODE}/`), CODE);
  assert.equal(sharedReferralCode(`https://holupp.net/app?ref=${CODE}`), CODE);
  assert.equal(sharedReferralCode(`holup://invite/${CODE}`), CODE);
  assert.equal(sharedReferralCode(`crushly://i/${CODE}`), CODE);
});

test('foreign hosts, wrong paths, and malformed codes are ignored', () => {
  for (const url of [
    `https://evil.example/i/${CODE}`,
    `https://holupp.net/v/${CODE}`,
    `https://holupp.net/app?ref=${'b'.repeat(31)}`,
    `holup://space/${CODE}`,
    `https://${['holupapp', 'vercel'].join('.')}/i/${CODE}`,
    'not a url',
    null,
  ]) assert.equal(sharedReferralCode(url), null, String(url));
});
