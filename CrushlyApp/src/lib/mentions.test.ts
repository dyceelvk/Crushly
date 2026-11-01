import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeToken, applyToken } from './mentions';

test('a bare @ opens the list before anything is typed', () => {
  const t = activeToken('Nice one @', 'Nice one @'.length);
  assert.deepEqual(t, { kind: 'mention', query: '', start: 9, end: 'Nice one @'.length });
});

test('a handle written so far is the query', () => {
  assert.deepEqual(activeToken('hello @ada', 10), { kind: 'mention', query: 'ada', start: 6, end: 10 });
  assert.deepEqual(activeToken('@n.g_o', 6), { kind: 'mention', query: 'n.g_o', start: 0, end: 6 });
  // A caret parked in the middle of a handle is still choosing it.
  assert.deepEqual(activeToken('hello @ada', 9), { kind: 'mention', query: 'ad', start: 6, end: 9 });
});

test('a hash is a tag, and takes the same shape', () => {
  assert.deepEqual(activeToken('shot on #film', 13), { kind: 'tag', query: 'film', start: 8, end: 13 });
});

test('a second mention is its own token, not a longer first one', () => {
  assert.deepEqual(activeToken('@ada and @ng', 12), { kind: 'mention', query: 'ng', start: 9, end: 12 });
});

test('a space ends the token', () => {
  assert.equal(activeToken('@ada hello', 10), null);
});

test('an email address is not a mention', () => {
  assert.equal(activeToken('mail me@ada.com', 15), null);
});

test('a caret parked after a finished mention is not still choosing it', () => {
  // The caret is past the handle, in the space beyond it.
  assert.equal(activeToken('@ada is here', 5), null);
  // Punctuation after a handle ends it as surely as a space does.
  assert.equal(activeToken('@ada, hello', 6), null);
});

test('nothing typed is nothing to suggest', () => {
  assert.equal(activeToken('', 0), null);
  assert.equal(activeToken('plain words', 11), null);
});

test('picking somebody swaps the fragment and lands the caret after it', () => {
  const text = 'Nice one @ad';
  const token = activeToken(text, text.length);
  assert.ok(token);
  const out = applyToken(text, token!, 'ada');
  assert.equal(out.text, 'Nice one @ada ');
  assert.equal(out.caret, out.text.length);
  // And the next word does not start with a doubled space.
  const again = applyToken('@ad there', { kind: 'mention', query: 'ad', start: 0, end: 3 }, 'ada');
  assert.equal(again.text, '@ada there');
});

test('picking a tag keeps the hash', () => {
  const text = '#fi';
  const token = activeToken(text, 3);
  const out = applyToken(text, token!, 'film');
  assert.equal(out.text, '#film ');
});
