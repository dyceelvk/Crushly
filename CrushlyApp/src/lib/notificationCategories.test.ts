import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromHolup, notificationCategory } from './notificationCategories';
test('notification categories keep post engagement and private whispers distinct', () => {
  for (const kind of ['post_comment','post_mention','post_reaction'] as const) assert.equal(notificationCategory(kind),'posts');
  for (const kind of ['message','moment_reply'] as const) assert.equal(notificationCategory(kind),'whispers');
  assert.equal(notificationCategory('keep'),'keptClose');
  assert.equal(notificationCategory('crush'),'addUps');
  assert.equal(fromHolup('verified'),true);
  assert.equal(fromHolup('message'),false);
});
