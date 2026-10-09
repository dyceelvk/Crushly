import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isVerificationReturn, redirectToVerification, verificationPhase } from './verification';

test('redirects in the current tab even after an asynchronous session request', async () => {
  const visited: string[] = [];
  const url = await Promise.resolve('https://verify.didit.me/session/example');
  redirectToVerification(url, { assign: (value) => visited.push(value) });
  assert.deepEqual(visited, [url]);
});

test('rejects unsafe verification URLs without navigating', () => {
  for (const url of ['javascript:alert(1)', 'http://verify.didit.me', 'https://user:pass@example.com', 'not-a-url']) {
    assert.throws(() => redirectToVerification(url, { assign: () => assert.fail('must not navigate') }));
  }
});

test('recognizes current and legacy return callbacks without trusting the result query', () => {
  assert.equal(isVerificationReturn('?didit=done&status=Approved'), true);
  assert.equal(isVerificationReturn('?status=Approved'), false);
  assert.equal(isVerificationReturn(''), false);
});

test('review is shown only when the provider actually reports In Review', () => {
  assert.equal(verificationPhase(null), 'ready');
  assert.equal(verificationPhase('Not Started'), 'ready');
  assert.equal(verificationPhase('In Progress'), 'progress');
  assert.equal(verificationPhase('In Review'), 'review');
  assert.equal(verificationPhase('Expired'), 'ready');
});
