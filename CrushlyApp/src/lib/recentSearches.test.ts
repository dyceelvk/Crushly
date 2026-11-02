import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECENT_LIMIT, parseRecents, pushRecent, removeRecent, serializeRecents } from './recentSearches';

test('a new search goes to the front', () => {
  assert.deepEqual(pushRecent(['ada'], 'ngozi'), ['ngozi', 'ada']);
});

test('a repeat moves instead of duplicating, whatever its case', () => {
  assert.deepEqual(pushRecent(['ada', 'ngozi'], 'ADA'), ['ADA', 'ngozi']);
});

test('one letter is not a search', () => {
  const list = ['ada'];
  assert.equal(pushRecent(list, 'a'), list);
  assert.equal(pushRecent(list, '   '), list);
});

test('the list stays short', () => {
  let list: string[] = [];
  for (let i = 0; i < 20; i++) list = pushRecent(list, `word${i}`);
  assert.equal(list.length, RECENT_LIMIT);
  assert.equal(list[0], 'word19');
});

test('a word can be removed', () => {
  assert.deepEqual(removeRecent(['ada', 'ngozi'], 'ADA'), ['ngozi']);
});

test('stored lists are not trusted', () => {
  assert.deepEqual(parseRecents(null), []);
  assert.deepEqual(parseRecents('nonsense'), []);
  assert.deepEqual(parseRecents('{"a":1}'), []);
  assert.deepEqual(parseRecents('["ada",7,"x","ngozi"]'), ['ada', 'ngozi']);
});

test('what is stored can be read back', () => {
  const list = pushRecent(pushRecent([], 'ada'), 'ngozi');
  assert.deepEqual(parseRecents(serializeRecents(list)), list);
});
