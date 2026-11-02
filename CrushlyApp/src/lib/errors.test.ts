import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorLine, errorTitle, isMissingFunctionResponse, isOffline, OFFLINE_ERROR, GENERIC_ERROR } from './errors';

test('error toast headings read like clear, member-facing sentences', () => {
  assert.equal(errorTitle('Not saved'), 'Couldn’t save your changes');
  assert.equal(errorTitle('Not let go'), 'Couldn’t remove this Connection');
  assert.equal(errorTitle('That clip is too long'), 'That clip is too long');
});

test('connection failures tell the member what to do', () => {
  assert.equal(errorLine(new TypeError('Failed to fetch')), OFFLINE_ERROR);
  assert.equal(errorLine(new Error('Network request failed')), OFFLINE_ERROR);
  assert.equal(errorLine({ message: 'Load failed' }), OFFLINE_ERROR);
  assert.equal(isOffline(new TypeError('Failed to fetch')), true);
});

test('auth failures have clear, specific next steps', () => {
  assert.equal(errorLine(new Error('Invalid login credentials')), 'That email and password don’t match. Check them and try again.');
  assert.equal(errorLine(new Error('Email not confirmed')), 'Confirm your email first. Check your inbox for the code or link.');
  assert.equal(errorLine(new Error('Token has expired')), 'That code or link has expired. Request a new one.');
  assert.equal(errorLine(new Error('Email rate limit exceeded')), 'Too many attempts just now. Wait a little, then try again.');
  assert.equal(errorLine(new Error('Error sending confirmation email')), 'We couldn’t send the email just now. Please try again in a moment.');
});

test('database and runtime details never reach the member', () => {
  for (const raw of [
    'Cannot read properties of undefined',
    'new row violates check constraint "profiles_bio_check"',
    'duplicate key value violates unique constraint "users_username_key"',
    'permission denied for table profiles',
    'PGRST116',
    'JWT expired',
    'Query data cannot be undefined. Query key: ["conversation",1]',
    'relation "x" does not exist',
    'The Supabase URL in this build is wrong. Set EXPO_PUBLIC_SUPABASE_URL.',
    'The database schema isn’t set up. Run the backend migration.',
  ]) {
    assert.equal(errorLine(new Error(raw)), GENERIC_ERROR, raw);
  }
});

test('clear member-facing sentences pass through unchanged', () => {
  assert.equal(errorLine(new Error('You can show up to 6 photos.')), 'You can show up to 6 photos.');
  assert.equal(errorLine(new Error('Keep at least one photo on your Space.')), 'Keep at least one photo on your Space.');
  assert.equal(errorLine('This Space isn’t available.'), 'This Space isn’t available.');
  assert.equal(errorLine('That Space is private. Ask them for a key.'), 'That Space is private. Ask them for a key.');
});

test('empty, overlong, or opaque values use clean retry copy', () => {
  for (const empty of [null, undefined, '', '   ', {}, { message: 42 }, [], 'PGRST000']) {
    assert.equal(errorLine(empty), GENERIC_ERROR);
  }
  const long = 'Could not complete the operation because ' + 'x'.repeat(400);
  assert.equal(errorLine(long), GENERIC_ERROR);
  assert.equal(errorLine(new Error('relation "x" does not exist'), 'This Space isn’t available.'), 'This Space isn’t available.');
});

test('a missing database function is recognised, not mistaken for a broken schema', () => {
  // The exact shape PostgREST returns when the RPC in the app is newer than the
  // database it is talking to. This used to be swallowed by the "schema cache"
  // branch, which is how the home feed ended up showing an error over itself
  // instead of falling back to the timeline it already had.
  assert.equal(
    isMissingFunctionResponse('Could not find the function public.flow_ranked_feed(p_cursor, p_limit) in the schema cache', 'PGRST202'),
    true,
  );
  assert.equal(isMissingFunctionResponse('function public.flow_ranked_feed(jsonb, integer) does not exist', '42883'), true);
  assert.equal(isMissingFunctionResponse('permission denied for function flow_feed', '42501'), false);
  assert.equal(isMissingFunctionResponse('Could not find the table public.nope in the schema cache', 'PGRST205'), false);
  assert.equal(isMissingFunctionResponse(undefined), false);
});
