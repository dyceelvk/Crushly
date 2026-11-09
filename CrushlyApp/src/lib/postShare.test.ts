import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postShareUrl, sharedPostId } from './postShare';
test('post links are canonical and parse on web and Android', () => {
  assert.equal(postShareUrl(23), 'https://holupapp.vercel.app/v/23');
  assert.equal(sharedPostId('crushly://v/23'), 23);
  assert.equal(sharedPostId('https://holupapp.vercel.app/?post=23'), 23);
  assert.equal(sharedPostId('https://mecrushly.vercel.app/v/23'), 23);
});
test('rejects untrusted domains and malformed ids', () => {
  for (const s of ['https://evil.example/?post=23','crushly://v/0','crushly://v/123/foo','https://holupapp.vercel.app/v/9007199254740993']) assert.equal(sharedPostId(s), null);
  assert.throws(() => postShareUrl(-1));
});
