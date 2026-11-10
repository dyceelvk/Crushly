import assert from 'node:assert/strict';
import test from 'node:test';
import { backendFromProbe, isMissingFunctionError, relationshipBackendFromResponse } from './relationshipFallback';

/**
 * The regression this guards: production answered `PGRST202` for
 * `holup_follow_status`, the app read every Add Up / Homie call as a failure,
 * and the Space page filled with Retry chips. Detection has to be narrow in
 * both directions — miss a missing routine and the page breaks again; treat a
 * refusal as missing and a live v2 backend gets silently downgraded.
 */

test('a missing routine is recognised by PostgREST code', () => {
  assert.equal(isMissingFunctionError({ code: 'PGRST202', status: 404 }), true);
});

test('a missing routine is recognised by its message when no code rides along', () => {
  assert.equal(
    isMissingFunctionError({ message: "Could not find the function public.holup_follow_status(p_target) in the schema cache" }),
    true,
  );
  assert.equal(isMissingFunctionError({ message: 'ERROR: 42883 function public.holup_homie_stats(integer) does not exist' }), true);
});

test('a routine that answered 404 for its own reasons is not "missing"', () => {
  for (const message of ['Space not available', 'This list is private', 'Not found']) {
    assert.equal(isMissingFunctionError({ code: 'PGRST116', status: 404, message }), false, message);
  }
});

test('refusals, blocks and network faults are not missing-function errors', () => {
  assert.equal(isMissingFunctionError({ code: '42501', message: 'permission denied for function holup_follow_status' }), false);
  assert.equal(isMissingFunctionError({ code: 'P0001', message: 'blocked' }), false);
  assert.equal(isMissingFunctionError({ status: 0, message: 'Network request failed' }), false);
  assert.equal(isMissingFunctionError(undefined), false);
  assert.equal(isMissingFunctionError(null), false);
});

test('only a confirmed absence selects the legacy contract', () => {
  assert.equal(backendFromProbe({ missing: true }), 'legacy');
  assert.equal(backendFromProbe({ missing: false }), 'v2');
});


test('real Supabase resolved error response selects deployed legacy contract', () => {
  assert.equal(relationshipBackendFromResponse({code:'PGRST202', message:'Could not find the function public.holup_follow_status(p_target)'}), 'legacy');
  assert.equal(relationshipBackendFromResponse(null), 'v2');
  assert.equal(relationshipBackendFromResponse({code:'P0001', message:'__CRUSHLY__404____Space not available.'}), 'v2');
});
test('authentication and network failures are not cached as either backend', () => {
  const permission={code:'42501', message:'permission denied'};
  const network={message:'TypeError: Failed to fetch'};
  assert.throws(() => relationshipBackendFromResponse(permission), (error) => error === permission);
  assert.throws(() => relationshipBackendFromResponse(network), (error) => error === network);
});
