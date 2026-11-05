import assert from 'node:assert/strict';
import test from 'node:test';
import { VIDEO_ENABLED, isShown, shownPosts } from './features';

const photo = { id: 1, mediaKind: 'photo' as const };
const clip = { id: 2, mediaKind: 'video' as const };
const words = { id: 3, mediaKind: null };

test('clips are back on', () => {
  assert.equal(VIDEO_ENABLED, true, 'video is part of the product again');
});

test('a clip is shown, and so is a photo and a few words', () => {
  assert.equal(isShown(clip), true);
  assert.equal(isShown(photo), true);
  assert.equal(isShown(words), true);
});

test('a list keeps every post, in order', () => {
  const list = shownPosts([photo, clip, words, { id: 4, mediaKind: 'video' as const }]);
  assert.deepEqual(list.map((p) => p.id), [1, 2, 3, 4]);
});

test('an empty list stays empty and is not shared with the caller', () => {
  const input: { mediaKind: 'photo' | 'video' | null }[] = [];
  const out = shownPosts(input);
  assert.deepEqual(out, []);
  assert.notEqual(out, input);
});
