import assert from 'node:assert/strict';
import test from 'node:test';
import { profileShareUrl, sharedProfile } from './profileShare';

test('a Space link is minted on the domain, with the handle and never an id', () => {
  assert.equal(profileShareUrl('jomablaq2'), 'https://holupp.net/u/jomablaq2');
  assert.equal(profileShareUrl('@JomaBlaq2'), 'https://holupp.net/u/jomablaq2');
});

test('a Space with no usable handle cannot be shared, rather than sharing nothing', () => {
  for (const bad of ['', '   ', 'a', 'has space', 'emoji🙂', 'x'.repeat(31)]) {
    assert.throws(() => profileShareUrl(bad), bad);
  }
});

test('our own links are read back, on every host we have used', () => {
  assert.equal(sharedProfile('https://holupp.net/u/jomablaq2'), 'jomablaq2');
  assert.equal(sharedProfile('https://www.holupp.net/u/jomablaq2/'), 'jomablaq2');
  assert.equal(sharedProfile('https://holupapp.vercel.app/u/jomablaq2'), 'jomablaq2');
  assert.equal(sharedProfile('holup://space/jomablaq2'), 'jomablaq2');
});

test('a lookalike or a stray path is not a Space link', () => {
  for (const bad of ['https://evil.example/u/jomablaq2', 'https://holupp.net/u/1', 'https://holupp.net/v/12', 'not a url', null]) {
    assert.equal(sharedProfile(bad as string), null, String(bad));
  }
});
