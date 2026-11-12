import assert from 'node:assert/strict';
import test from 'node:test';
import { PUBLIC_HOSTS, PUBLIC_SITE, isPublicHost } from './publicSite';

test('new links are minted on the bought domain', () => {
  assert.equal(PUBLIC_SITE, 'https://holupp.net');
  assert.ok(!PUBLIC_SITE.includes('vercel.app'));
});

test('the domain it replaces is still accepted, so old shares keep working', () => {
  assert.ok(isPublicHost('holupapp.vercel.app'));
  assert.ok(isPublicHost('holupp.net'));
  assert.ok(isPublicHost('WWW.HOLUPP.NET'));
});

test('a lookalike host is not ours', () => {
  for (const host of ['holupp.net.evil.example', 'evil.example', 'not-holupp.net', '']) {
    assert.equal(isPublicHost(host), false, host);
  }
  assert.equal(PUBLIC_HOSTS.length >= 4, true);
});
