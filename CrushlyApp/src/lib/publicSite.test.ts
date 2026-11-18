import assert from 'node:assert/strict';
import test from 'node:test';
import { PUBLIC_HOSTS, PUBLIC_SITE, RETIRED_HOSTS, isPublicHost, isRetiredHost } from './publicSite';

test('new links are minted on the bought domain', () => {
  assert.equal(PUBLIC_SITE, 'https://holupp.net');
  assert.ok(!PUBLIC_SITE.includes('vercel.app'));
});

test('the domain it replaces is still accepted, so old shares keep working', () => {
  assert.ok(isPublicHost('holupp.net'));
  assert.ok(isPublicHost('WWW.HOLUPP.NET'));
});

test('a retired hostname is not a holUpp host any more', () => {
  // It belongs to no project: accepting it would mean advertising a page that
  // answers Vercel's "deployment not found".
  assert.equal(isPublicHost('holupapp.vercel.app'), false);
  assert.equal(isRetiredHost('holupapp.vercel.app'), true);
  assert.equal(RETIRED_HOSTS.includes('holupapp.vercel.app'), true);
  // And nothing new may be minted on it.
  for (const host of PUBLIC_HOSTS) assert.ok(!host.includes('holupapp'), host);
});

test('a lookalike host is not ours', () => {
  for (const host of ['holupp.net.evil.example', 'evil.example', 'not-holupp.net', '']) {
    assert.equal(isPublicHost(host), false, host);
  }
  assert.equal(PUBLIC_HOSTS.length >= 3, true);
});
