/**
 * What a visitor sees, and what a member is promised at sign-up.
 *
 * Two rules that are easy to break silently and expensive to break loudly:
 *
 *   1. A signed-out browser lands on the room, not on a slogan with a pop-up over
 *      it. The old web home answered a stranger with two buttons and a claim about
 *      feelings, and then covered it with a "get the app" card.
 *   2. Sign-up introduces the network before it introduces any relationship
 *      feature. Romantic connections remain in the product, but they are not the
 *      explanation for why HolUpp exists.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { leadWithCategories, watchCategoryOf, publicWatchHousePosts, hasCategoryLead, WATCH_CATEGORIES } from './watch';
import type { WatchPost } from '../api/types';

const post = (id: number, body: string | null, username = 'someone'): WatchPost => ({
  id, body, mediaUrl: null, mediaKind: null, createdAt: 1_700_000_000_000 + id,
  likeCount: 0, commentCount: 0,
  author: { id, name: username, username, verified: false, badgeTier: 'none', photos: [] },
});

test('football, animation and entertainment are recognised, in that order', () => {
  assert.equal(watchCategoryOf('What a goal by Osimhen'), 'football');
  assert.equal(watchCategoryOf('This anime edit is unreal'), 'animation');
  assert.equal(watchCategoryOf('New afrobeats skit 😂'), 'entertainment');
  // A post about nothing in particular belongs to no category, and must not be
  // forced into one — otherwise everything eventually reads as "entertainment".
  assert.equal(watchCategoryOf('good morning everyone'), null);
  assert.equal(watchCategoryOf(null), null);
  assert.deepEqual(WATCH_CATEGORIES.map((c) => c.id), ['football', 'animation', 'entertainment']);
});

test('the three subjects lead the feed without dropping anything or reordering within a band', () => {
  const feed = [
    post(1, 'good morning'),
    post(2, 'a skit about Lagos'),
    post(3, 'Messi again'),
    post(4, 'another normal post'),
    post(5, 'cartoon nostalgia'),
  ];
  const led = leadWithCategories(feed);
  assert.deepEqual(led.map((p) => p.id), [3, 5, 2, 1, 4]);
  assert.equal(led.length, feed.length);
});

test('a page with nothing in the three subjects is detectable, so holUpp can lead', () => {
  assert.equal(hasCategoryLead([post(1, 'good morning'), post(2, 'hello')]), false);
  assert.equal(hasCategoryLead([post(1, 'good morning'), post(2, 'Osimhen scored again')]), true);
});

test('when a category is empty the company accounts are offered as the fallback', () => {
  const feed = [post(1, 'Stay connected', 'holupp'), post(2, 'hello', 'ada'), post(3, 'Help', 'info_holup')];
  assert.deepEqual(publicWatchHousePosts(feed).map((p) => p.id), [1, 3]);
});

test('the web home is the room, and the interstitial is off', () => {
  const nav = readFileSync(new URL('../navigation/RootNavigator.tsx', import.meta.url), 'utf8');
  assert.match(nav, /Platform\.OS === 'web' \? WatchScreen : FollowScreen/,
    'a signed-out browser must land on WatchScreen');

  const gate = readFileSync(new URL('../components/WebGate.tsx', import.meta.url), 'utf8');
  assert.match(gate, /export function webGateActive\(\): boolean \{\s*return false;/,
    'the web notice must not be shown over the home page');
});

test('sign-up introduces the social network before offering official Add Ups', () => {
  const onboarding = readFileSync(new URL('../screens/onboarding/Onboarding.tsx', import.meta.url), 'utf8');
  assert.match(onboarding, /Welcome to HolUpp/);
  assert.match(onboarding, /Your world\. Your people\. Your expression\./);
  for (const feature of ['Flow', 'Connections', 'Circles', 'Space', 'Moments', 'Crushes']) {
    assert.match(onboarding, new RegExp(`label: '${feature}'`), `onboarding must introduce ${feature}`);
  }
  assert.match(onboarding, /const OFFICIAL_ACCOUNTS/);
  assert.match(onboarding, /title="Stay close to HolUpp"/);
  assert.match(onboarding, /accessibilityLabel=\{`Add Up to @\$\{account\.handle\}`\}/);
  assert.match(onboarding, /await completeOnboarding\(\)/);
  assert.match(onboarding, /followStatus\(id\)/);
  assert.ok(onboarding.indexOf('await completeOnboarding()') < onboarding.indexOf('await followMember(id)'),
    'the profile must be onboarded before the Add Up is sent');
});

test('the visitor feed cannot carry what a stranger may not see', () => {
  const source = readFileSync(new URL('../api/types.ts', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('export type WatchPost'), source.indexOf('export type AppUpdate'));
  for (const forbidden of ['distance', 'online', 'activity', 'privacy', 'crush', 'canMessage']) {
    assert.ok(!block.includes(forbidden), `WatchPost must not carry "${forbidden}"`);
  }
});
