import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const source = readFileSync(fileURLToPath(new URL('../api/service.ts', import.meta.url)), 'utf8');
const section = (a: string, b: string) => source.slice(source.indexOf(a), source.indexOf(b));

test('legacy Homie and Add Up actions never change legacy connections', () => {
  const api = section('export const homieStatus', 'export async function setFollowSettings');
  assert.doesNotMatch(api, /crush_member|uncrush_member|accept_connection_request|decline_connection_request|cancel_connection_request/);
  assert.match(api, /available: false/);
  assert.match(api, /not available until the relationship update is ready/);
});
test('legacy list reads use the existing privacy-filtered routines', () => {
  assert.match(source, /space_relationship_stats/);
  assert.match(source, /space_relationship_people/);
});
