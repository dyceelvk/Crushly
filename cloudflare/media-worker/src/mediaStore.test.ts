/**
 * Which store media is written to, read from and deleted from.
 *
 * These are three different questions and the code used to answer them as one.
 * A file written to one store and read from the other uploads perfectly and is
 * then permanently broken — no error anywhere, just a photo that never loads.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { READ_ORDER, DELETE_STORES, writeStore, isReleasePath } from './mediaStore';

test('new media is written to R2, where serving it costs nothing', () => {
  for (const path of ['posts/2026/11/abc.jpg', 'moments/xyz.mp4', 'messages/1/2/voice.m4a', 'photos/p.png']) {
    assert.equal(writeStore(path), 'r2', path);
  }
});

test('reads try R2 first and B2 second, in that order', () => {
  assert.deepEqual(READ_ORDER, ['r2', 'b2']);
});

test('deletes clear both stores, so no copy is left behind', () => {
  assert.deepEqual(DELETE_STORES, ['r2', 'b2']);
});

test('the APK is never mistaken for member media', () => {
  assert.equal(isReleasePath('android-releases/holUpp-1.0.96-RielOS.apk'), true);
  assert.equal(isReleasePath('posts/2026/11/abc.jpg'), false);
});
