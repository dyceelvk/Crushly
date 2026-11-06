import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeHighlight } from './highlights';

test('a room that has been talking is the most talked conversation', () => {
  assert.equal(describeHighlight({ kind: 'conversation', likes: 0, comments: 0 })?.caption, 'Most Talked Conversation');
});

test('a post with more reactions than replies is the most crushed post', () => {
  assert.equal(describeHighlight({ kind: 'post', likes: 12, comments: 3 })?.caption, 'Most Crushed Post');
});

test('a post that got talked about more than crushed says so', () => {
  assert.equal(describeHighlight({ kind: 'post', likes: 2, comments: 9 })?.caption, 'Most Talked Post');
});

test('a tie reads as crushed — the reaction is the louder signal', () => {
  assert.equal(describeHighlight({ kind: 'post', likes: 4, comments: 4 })?.caption, 'Most Crushed Post');
});

test('every caption carries the icon that says it in one shape', () => {
  assert.equal(describeHighlight({ kind: 'post', likes: 1, comments: 0 })?.icon, 'trophy');
  assert.equal(describeHighlight({ kind: 'post', likes: 0, comments: 1 })?.icon, 'chatbubbles-outline');
  assert.equal(describeHighlight({ kind: 'conversation', likes: 0, comments: 0 })?.icon, 'chatbubble-ellipses');
});

test('a post nobody crushed and nobody answered is not a highlight at all', () => {
  // The bug this closes: a room whose newest post had nothing on it still got a
  // tile, and the caption fell through to "Most Crushed Post".
  assert.equal(describeHighlight({ kind: 'post', likes: 0, comments: 0 }), null);
  assert.equal(describeHighlight({ kind: 'quiet', likes: 0, comments: 0 }), null);
});

test('a post with a single Crush is still a Most Crushed Post', () => {
  assert.equal(describeHighlight({ kind: 'post', likes: 1, comments: 0 })?.caption, 'Most Crushed Post');
});
