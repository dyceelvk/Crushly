import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorLine, isOffline, GENERIC_ERROR } from './errors';

/**
 * The rule: a member reads a message only if a person wrote it for them. A
 * runtime, a network layer and a database all produce strings; none of them are
 * a member-facing sentence.
 */

test('a failed connection is not a sentence a member should read', () => {
  assert.equal(errorLine(new TypeError('Failed to fetch')), GENERIC_ERROR);
  assert.equal(errorLine(new Error('Network request failed')), GENERIC_ERROR);
  assert.equal(errorLine({ message: 'Load failed' }), GENERIC_ERROR);
});

test('database complaints stay inside the database', () => {
  assert.equal(
    errorLine(new Error('new row violates check constraint "profiles_bio_check"')),
    GENERIC_ERROR,
  );
  assert.equal(errorLine(new Error('duplicate key value violates unique constraint "users_username_key"')), GENERIC_ERROR);
  assert.equal(errorLine(new Error('permission denied for table profiles')), GENERIC_ERROR);
  assert.equal(errorLine(new Error('PGRST116')), GENERIC_ERROR);
  assert.equal(errorLine(new Error('JWT expired')), GENERIC_ERROR);
});

test('a message written for a person is shown as written', () => {
  assert.equal(errorLine(new Error('You can show up to 6 photos.')), 'You can show up to 6 photos.');
  assert.equal(errorLine(new Error('Keep at least one photo on your Space.')), 'Keep at least one photo on your Space.');
  assert.equal(errorLine('This Space isn’t available.'), 'This Space isn’t available.');
});

test('nothing at all falls back', () => {
  for (const nothing of [null, undefined, '', '   ', {}, { message: 42 }, []]) {
    assert.equal(errorLine(nothing), GENERIC_ERROR);
  }
});

test('a wall of text is not a message', () => {
  const long = 'Could not complete the operation because ' + 'x'.repeat(400);
  assert.equal(errorLine(new Error(long)), GENERIC_ERROR);
});

test('the caller can choose its own fallback sentence', () => {
  assert.equal(errorLine(new TypeError('Failed to fetch'), 'This Space isn’t available.'), 'This Space isn’t available.');
});

test('offline is distinguishable from refused, because the advice differs', () => {
  assert.equal(isOffline(new TypeError('Failed to fetch')), true);
  assert.equal(isOffline(new Error('You can show up to 6 photos.')), false);
  assert.equal(isOffline(null), false);
});

test('a query library talking about itself is not a message', () => {
  // Found by rendering the empty Chat error state with only the raw error to
  // show: React Query's own wording reached the member, key and all.
  assert.equal(errorLine('Query data cannot be undefined. Query key: ["conversation",1]'), GENERIC_ERROR);
  assert.equal(errorLine(new Error('["conversation",1] data is undefined')), GENERIC_ERROR);
  assert.equal(errorLine('[{"items":[]}] No queryFn found'), GENERIC_ERROR);
});

test('a member-facing sentence that mentions a key still gets through', () => {
  assert.equal(errorLine('That Space is private. Ask them for a key.'), 'That Space is private. Ask them for a key.');
});
