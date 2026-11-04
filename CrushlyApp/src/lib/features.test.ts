import assert from 'node:assert/strict';
import test from 'node:test';
import { VIDEO_ENABLED, isShown, shownPosts } from './features';

const photo = { id: 1, mediaKind: 'photo' as const };
const clip = { id: 2, mediaKind: 'video' as const };
const words = { id: 3, mediaKind: null };

test('this build does not show clips', () => {
  assert.equal(VIDEO_ENABLED, false, 'video is switched off until there is a room to announce it in');
});

test('a clip is not shown; a photo and a few words are', () => {
  assert.equal(isShown(clip), false);
  assert.equal(isShown(photo), true);
  assert.equal(isShown(words), true);
});

test('a list drops clips and keeps the rest in order', () => {
  const list = shownPosts([photo, clip, words, { id: 4, mediaKind: 'video' as const }]);
  assert.deepEqual(list.map((p) => p.id), [1, 3]);
});

test('an empty list stays empty and is not shared with the caller', () => {
  const input: { mediaKind: 'photo' | 'video' | null }[] = [];
  const out = shownPosts(input);
  assert.deepEqual(out, []);
  assert.notEqual(out, input);
});
