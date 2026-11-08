import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { uploadContentType, publicRpcError } from './uploadType';
const bytes = (s: number[]) => new Uint8Array(s).buffer;
const box = (brand: string) => bytes([0,0,0,24,102,116,121,112,...Array.from(brand).map(x => x.charCodeAt(0)),0,0,0,0,105,115,111,109,109,112,52,50]);
test('recovers a mislabelled MP4 without accepting arbitrary bytes', () => {
  assert.equal(uploadContentType('application/octet-stream', box('isom')), 'video/mp4');
  assert.equal(uploadContentType('application/x-unknown', box('mp42')), 'video/mp4');
  assert.equal(uploadContentType('application/octet-stream', bytes([0,0,0,0])), 'application/octet-stream');
});
test('does not mislabel HEIC or AVIF as video', () => {
  assert.equal(uploadContentType('application/octet-stream', box('heic')), 'application/octet-stream');
  assert.equal(uploadContentType('application/octet-stream', box('avif')), 'application/octet-stream');
});
test('preserves registered content types and recognises valid image headers', () => {
  assert.equal(uploadContentType('video/mp4; codecs=avc1', bytes([1,2])), 'video/mp4');
  assert.equal(uploadContentType('binary/octet-stream', bytes([255,216,255,2])), 'image/jpeg');
  assert.equal(uploadContentType('binary/octet-stream', bytes([137,80,78,71,13,10,26,10])), 'image/png');
});
test('handles QuickTime and WebM and rejects bogus boxes', () => {
  assert.equal(uploadContentType('application/unknown', box('qt  ')), 'video/quicktime');
  assert.equal(uploadContentType('application/unknown', bytes([0x1a,0x45,0xdf,0xa3,119,101,98,109])), 'video/webm');
  assert.equal(uploadContentType('application/unknown', bytes([0,0,0,40,102,116,121,112,105,115,111,109])), 'application/unknown');
});
test('sanitises the database error envelope', () => {
  assert.deepEqual(publicRpcError('__CRUSHLY__415____That file type is not supported.', 400), {status:415,message:'That file type is not supported.'});
  assert.deepEqual(publicRpcError('Other error', 500), {status:500,message:'Other error'});
});
