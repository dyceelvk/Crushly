import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canSaveClip, clipFileName } from './clipSaveRules';

// The rule under test is not "a download works" — it is that a download is
// offered only when a marked copy exists, so a copy that leaves the app can
// never be an unmarked one.

test('a clip with a marked copy can be saved', () => {
  assert.equal(canSaveClip({ mediaKind: 'video', downloadUrl: 'https://cdn/x-marked.mp4' }), true);
});

test('a clip with no marked copy is not offered a download', () => {
  // Falling back to mediaUrl would hand out somebody's work unattributed.
  assert.equal(canSaveClip({ mediaKind: 'video', downloadUrl: null }), false);
  assert.equal(canSaveClip({ mediaKind: 'video' }), false);
  assert.equal(canSaveClip({ mediaKind: 'video', downloadUrl: '' }), false);
});

test('a photo is never a saveable clip', () => {
  // A photo never gets a marked copy, so the server answers "none" for it and
  // there is no URL to save. The URL is the evidence; `mediaKind` is a guess the
  // feed makes from the same URL, and it used to veto real copies.
  assert.equal(canSaveClip({ mediaKind: 'photo', downloadUrl: null }), false);
  assert.equal(canSaveClip({ mediaKind: 'photo' }), false);
  assert.equal(canSaveClip({}), false);
  assert.equal(canSaveClip({ downloadUrl: '' }), false);
  // A copy that the server handed over is saveable even when the feed guessed
  // "photo" from an unusual URL — that mismatch is exactly the bug this rule
  // was rewritten for.
  assert.equal(canSaveClip({ mediaKind: 'photo', downloadUrl: 'https://cdn/x.mp4' }), true);
  assert.equal(canSaveClip({ mediaKind: null, downloadUrl: 'https://cdn/x.mp4' }), true);
});

test('the saved file is named after the post, not the storage key', () => {
  assert.equal(clipFileName(42, 'https://cdn.example/media/abc123.mp4'), 'holup-42.mp4');
  // A signed URL has a query string; the extension still wins over the junk.
  assert.equal(clipFileName(7, 'https://cdn.example/x.MOV?token=abc.def'), 'holup-7.mov');
  assert.equal(clipFileName(9, 'https://cdn.example/no-extension'), 'holup-9.mp4');
});
