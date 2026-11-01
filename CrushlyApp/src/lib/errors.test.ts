import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorLine, isOffline, isHouseLine, OFFLINE_ERROR } from './errors';

/** Any of the house lines is a pass: which one depends on the failure, not the caller. */
function HOUSE(actual: string): true {
  if (!isHouseLine(actual)) throw new Error(`not a house line: ${actual}`);
  return true;
}

/**
 * The rule: a member reads a message only if a person wrote it for them. A
 * runtime, a network layer and a database all produce strings; none of them are
 * a member-facing sentence.
 */

test('a failed connection is not a sentence a member should read', () => {
  // It has its own line now, because the advice is different: a dropped
  // connection is worth waiting for, a refused request is not.
  assert.equal(errorLine(new TypeError('Failed to fetch')), OFFLINE_ERROR);
  assert.equal(errorLine(new Error('Network request failed')), OFFLINE_ERROR);
  assert.equal(errorLine({ message: 'Load failed' }), OFFLINE_ERROR);
  // Anything else technical still gets the house line, not a stack.
  HOUSE(errorLine(new Error('Cannot read properties of undefined')));
});

test('database complaints stay inside the database', () => {
  HOUSE(errorLine(new Error('new row violates check constraint "profiles_bio_check"')));
  HOUSE(errorLine(new Error('duplicate key value violates unique constraint "users_username_key"')));
  HOUSE(errorLine(new Error('permission denied for table profiles')));
  HOUSE(errorLine(new Error('PGRST116')));
  HOUSE(errorLine(new Error('JWT expired')));
});

test('a message written for a person is shown as written', () => {
  assert.equal(errorLine(new Error('You can show up to 6 photos.')), 'You can show up to 6 photos.');
  assert.equal(errorLine(new Error('Keep at least one photo on your Space.')), 'Keep at least one photo on your Space.');
  assert.equal(errorLine('This Space isn’t available.'), 'This Space isn’t available.');
});

test('nothing at all falls back', () => {
  for (const nothing of [null, undefined, '', '   ', {}, { message: 42 }, []]) {
    HOUSE(errorLine(nothing));
  }
});

test('a wall of text is not a message', () => {
  const long = 'Could not complete the operation because ' + 'x'.repeat(400);
  HOUSE(errorLine(new Error(long)));
});

test('the caller can choose its own fallback sentence', () => {
  assert.equal(errorLine(new Error('relation "x" does not exist'), 'This Space isn’t available.'), 'This Space isn’t available.');
  // But a connection failure outranks it: the socket is the story, not the page.
  assert.equal(errorLine(new TypeError('Failed to fetch'), 'This Space isn’t available.'), OFFLINE_ERROR);
});

test('the house lines are a set, not one sentence repeated', () => {
  const lines = new Set([0, 1, 2, 3].map((n) => (errorLine(`PGRST00${n}`) as string)));
  assert.ok(lines.size >= 3, 'a second failure in a row should not read identically');
});

test('offline is distinguishable from refused, because the advice differs', () => {
  assert.equal(isOffline(new TypeError('Failed to fetch')), true);
  assert.equal(isOffline(new Error('You can show up to 6 photos.')), false);
  assert.equal(isOffline(null), false);
});

test('a query library talking about itself is not a message', () => {
  // Found by rendering the empty Chat error state with only the raw error to
  // show: React Query's own wording reached the member, key and all.
  HOUSE(errorLine('Query data cannot be undefined. Query key: ["conversation",1]'));
  HOUSE(errorLine(new Error('["conversation",1] data is undefined')));
  HOUSE(errorLine('[{"items":[]}] No queryFn found'));
});

test('a member-facing sentence that mentions a key still gets through', () => {
  assert.equal(errorLine('That Space is private. Ask them for a key.'), 'That Space is private. Ask them for a key.');
});
