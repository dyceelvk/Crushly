import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postShareUrl, sharedPostId } from './postShare';
test('post links are canonical and parse on web and Android', () => {
  assert.equal(postShareUrl(23), 'https://holupp.net/v/23');
  assert.equal(sharedPostId('crushly://v/23'), 23);
  assert.equal(sharedPostId('holup://v/23'), 23);
  // A foreign scheme that happens to look like ours is still a foreign link.
  assert.equal(sharedPostId('holupx://v/23'), null);
  assert.equal(sharedPostId('https://holupp.net/?post=23'), 23);
  assert.equal(sharedPostId('https://mecrushly.vercel.app/v/23'), 23);
});
test('rejects untrusted domains and malformed ids', () => {
  for (const s of ['https://evil.example/?post=23','crushly://v/0','crushly://v/123/foo','https://holupp.net/v/9007199254740993']) assert.equal(sharedPostId(s), null);
  assert.throws(() => postShareUrl(-1));
});
