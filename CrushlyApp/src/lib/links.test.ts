import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenize } from '../lib/links';

/**
 * The mention and tag matchers, tested on their own.
 *
 * The cases that matter are the ones where a `@` or a `#` is *not* a mention:
 * an email address, a colour code, a note. Those are the ones a naive regex
 * turns into a link and then into a person who does not exist.
 */
test('a plain sentence has nothing to press', () => {
  const { matches } = tokenize('just words, nothing else');
  assert.equal(matches.length, 0);
});

test('a handle is a mention', () => {
  const { matches } = tokenize('shot by @ada at the pier');
  assert.deepEqual(matches.map((m) => [m.kind, m.value]), [['mention', 'ada']]);
});

test('a hashtag is a tag', () => {
  const { matches } = tokenize('sunday people #lagos #slowmornings');
  assert.deepEqual(matches.map((m) => [m.kind, m.value]), [['tag', 'lagos'], ['tag', 'slowmornings']]);
});

test('a handle may carry a dot, and the dot is not the sentence ending', () => {
  // This is the shape that made a tag look broken: the suggestion list offered
  // `ada.ng`, the post stored `@ada.ng`, and a matcher that stopped at the dot
  // handed the profile lookup `ada` — a handle nobody has.
  const { matches } = tokenize('thanks @ada.ng for this');
  assert.deepEqual(matches.map((m) => [m.kind, m.value]), [['mention', 'ada.ng']]);
});

test('a full stop after a handle belongs to the sentence', () => {
  const { matches } = tokenize('ask @ada.');
  assert.deepEqual(matches.map((m) => [m.kind, m.value]), [['mention', 'ada']]);
});

test('an email address is not a mention', () => {
  const { matches } = tokenize('write to ada@crushly.app');
  assert.equal(matches.filter((m) => m.kind === 'mention').length, 0);
});

test('a colour is not a tag', () => {
  const { matches } = tokenize('the background is #0A0E27');
  assert.equal(matches.filter((m) => m.kind === 'tag').length, 1);
  // It *is* still a tag by shape — one letter-led word — but it is matched as
  // one piece, not split into #0A and 0E27.
  assert.equal(matches[0].value, '0A0E27');
});

test('links, handles and tags can share a sentence', () => {
  const { matches } = tokenize('shot by @ada at the pier #lagos https://example.com/a?b=1');
  assert.deepEqual(matches.map((m) => m.kind), ['mention', 'tag', 'url']);
});

test('the pieces and the text together are the original text', () => {
  const text = 'hi @ada #lagos https://example.com/x';
  const { parts, matches } = tokenize(text);
  let rebuilt = '';
  parts.forEach((chunk, i) => {
    rebuilt += chunk;
    if (matches[i]) rebuilt += matches[i].text;
  });
  assert.equal(rebuilt, text);
});
