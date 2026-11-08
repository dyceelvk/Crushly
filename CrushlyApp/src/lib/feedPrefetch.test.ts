import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { feedImagePaths } from './feedPrefetch';

test('prefetches a bounded, deduplicated list of feed images, never video', () => {
  const posts = [
    { mediaKind: 'photo', mediaUrl: 'p1.jpg', author: { photos: [{ url: 'a.jpg' }] } },
    { mediaKind: 'video', mediaUrl: 'clip.mp4', author: { photos: [{ url: 'a.jpg' }] } },
    { mediaKind: 'photo', mediaUrl: 'p2.jpg', author: { photos: [] } },
  ];
  assert.deepEqual(feedImagePaths(posts), ['p1.jpg', 'a.jpg', 'p2.jpg']);
  assert.deepEqual(feedImagePaths(posts, 2), ['p1.jpg', 'a.jpg']);
  assert.deepEqual(feedImagePaths([], 8), []);
});
