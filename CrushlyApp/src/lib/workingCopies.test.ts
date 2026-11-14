import assert from 'node:assert/strict';
import test from 'node:test';
import { forgetPreparedCopies, isPreparedWorkingCopy, notePreparedCopy } from './workingCopies';

/*
 * The upload asks this before it compresses. If the answer is ever wrong for a
 * file the encoder made, the phone encodes the same footage twice: minutes of
 * MediaCodec work and a second generation of compression, which is the exact
 * complaint this work started from. It is also the only part of the working-copy
 * path that can be exercised without a phone, so it is exercised here.
 */
test('a picked file is not a working copy', () => {
  forgetPreparedCopies();
  assert.equal(isPreparedWorkingCopy('file:///data/user/0/app/cache/picked.mp4'), false);
});

test('a file the encoder produced is recognised, and only that one', () => {
  forgetPreparedCopies();
  notePreparedCopy('file:///data/user/0/app/cache/holupp-compressed/1720000000000.mp4');
  assert.equal(isPreparedWorkingCopy('file:///data/user/0/app/cache/holupp-compressed/1720000000000.mp4'), true);
  assert.equal(isPreparedWorkingCopy('file:///data/user/0/app/cache/holupp-compressed/1720000000001.mp4'), false);
});

test('an empty path is never a working copy', () => {
  forgetPreparedCopies();
  notePreparedCopy('');
  assert.equal(isPreparedWorkingCopy(''), false);
});
