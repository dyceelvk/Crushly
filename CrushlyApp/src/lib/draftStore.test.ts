import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createDraftStore, type DraftFileSystem } from './draftStore';

function memoryFs() {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  let failCopy = false;
  const fs: DraftFileSystem = {
    async makeDirectoryAsync(uri) { dirs.add(uri); dirs.add(uri.replace(/\d+-[a-z0-9]+\/$/, '')); },
    async copyAsync({ from, to }) { if (failCopy || !files.has(from)) throw new Error('copy failed'); files.set(to, files.get(from)!); },
    async getInfoAsync(uri) { return files.has(uri) ? { exists: true, size: files.get(uri)!.length } : { exists: dirs.has(uri) }; },
    async readDirectoryAsync(uri) { return [...dirs].filter(x => x.startsWith(uri) && x !== uri).map(x => x.slice(uri.length).replace(/\/$/, '')); },
    async writeAsStringAsync(uri, text) { files.set(uri, text); },
    async readAsStringAsync(uri) { if (!files.has(uri)) throw new Error('missing'); return files.get(uri)!; },
    async deleteAsync(uri) { for (const x of [...files.keys()]) if (x.startsWith(uri)) files.delete(x); for (const x of [...dirs]) if (x.startsWith(uri)) dirs.delete(x); },
  };
  return { fs, files, fail: () => { failCopy = true; } };
}

test('post and Moment media and edit recipes survive a fresh store and stay account-scoped', async () => {
  const m = memoryFs(); m.files.set('file:///cache/clip.mp4', 'video content'); m.files.set('file:///cache/photo.jpg', 'image content');
  let store = createDraftStore(m.fs, 'file:///private/hollop-drafts/');
  const post = await store.saveLocalDraft(42, { kind: 'post', body: 'my post', data: { media: { type: 'video', edit: { trim: 3 } }, commentsEnabled: false }, files: { media: 'file:///cache/clip.mp4' } });
  await store.saveLocalDraft(42, { kind: 'moment', body: 'my Moment', data: { mode: 'photo' }, files: { photo: 'file:///cache/photo.jpg' } });
  m.files.delete('file:///cache/clip.mp4'); m.files.delete('file:///cache/photo.jpg');
  store = createDraftStore(m.fs, 'file:///private/hollop-drafts/');
  const posts = await store.listLocalDrafts(42, 'post');
  assert.equal(posts.length, 1); assert.equal(posts[0].body, 'my post');
  assert.equal(m.files.get(posts[0].files.media), 'video content');
  assert.deepEqual(posts[0].data.media, { type: 'video', edit: { trim: 3 } });
  const moments = await store.listLocalDrafts(42, 'moment');
  assert.equal(m.files.get(moments[0].files.photo), 'image content');
  assert.equal((await store.listLocalDrafts(99, 'post')).length, 0);
  await store.deleteLocalDraft(42, post.id);
  assert.equal((await store.listLocalDrafts(42, 'post')).length, 0);
  assert.equal((await store.listLocalDrafts(42, 'moment')).length, 1);
});

test('a failed replacement never removes the previous saved draft', async () => {
  const m = memoryFs(); m.files.set('file:///cache/clip.mp4', 'video content');
  const store = createDraftStore(m.fs, 'file:///private/hollop-drafts/');
  const old = await store.saveLocalDraft(42, { kind: 'post', body: 'original', data: {}, files: { media: 'file:///cache/clip.mp4' } });
  m.fail();
  await assert.rejects(store.saveLocalDraft(42, { kind: 'post', body: 'changed', data: {}, files: { media: 'file:///cache/clip.mp4' } }, old.id));
  const drafts = await store.listLocalDrafts(42, 'post');
  assert.equal(drafts.length, 1); assert.equal(drafts[0].body, 'original');
});

test('a corrupt or missing media file is reported, not presented as an empty draft list', async () => {
  const m = memoryFs(); m.files.set('file:///cache/clip.mp4', 'video');
  const store = createDraftStore(m.fs, 'file:///private/hollop-drafts/');
  const saved = await store.saveLocalDraft(42, { kind: 'post', body: '', data: {}, files: { media: 'file:///cache/clip.mp4' } });
  m.files.delete(saved.files.media);
  await assert.rejects(store.listLocalDrafts(42, 'post'), /could not be read/);
});
