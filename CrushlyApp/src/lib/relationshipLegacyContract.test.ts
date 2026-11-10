import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/**
 * What the deployed database will actually let a signed-in member do.
 *
 * Two separate things broke the Space page in production, and only the first
 * was obvious:
 *
 *  1. the v2 routines do not exist (handled by relationshipBackend), and
 *  2. `is_connected_pair` exists but was never granted to `authenticated`, so
 *     asking it answers `42501 permission denied`. Counts loaded, and the
 *     buttons still said "Retry".
 *
 * This test pins the second lesson: the client asks for the `connections` row,
 * which row-level security already lets either party read.
 */
const source = readFileSync(fileURLToPath(new URL('../api/service.ts', import.meta.url)), 'utf8');

test('the app never calls a routine the deployed backend does not grant', () => {
  assert.ok(
    !/rpc(<[^>]*>)?\(\s*'is_connected_pair'/i.test(source),
    'is_connected_pair is not executable by authenticated (42501); read the connections row instead',
  );
});

test('legacy connection state comes from the row the caller may read', () => {
  assert.match(source, /from\('connections'\)/, 'connection state must come from the connections table');
  assert.match(source, /space_relationship_stats/, 'counts must come from the deployed stats routine');
  assert.match(source, /space_relationship_people/, 'lists must come from the deployed list routine');
});

test('an Add Up is read from the fields crush_member actually returns', () => {
  // The deployed routine answers {request, mutual, isNew}, never {connected}.
  // Reading the wrong field silently turns every answered Add Up into a pending one.
  assert.match(source, /result\?\.mutual === true/);
  assert.match(source, /result\?\.request === 'accepted'/);
  assert.match(source, /result\?\.request === 'connected'/);
});
