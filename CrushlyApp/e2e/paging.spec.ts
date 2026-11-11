/**
 * A feed is more than its first page.
 *
 * Joma scrolled on his own account and the posts stopped, and the reason was
 * not the database: Crushes held one page of twenty and, when the list reached
 * its end, asked for the older page and *replaced* the feed with it. Scrolling
 * therefore did not reveal older posts — it swapped what was on screen for a
 * different twenty, so everything above vanished and the feed looked emptied.
 * A Space had no pager at all.
 *
 * This reproduces the shape of that with two mocked pages: scroll, and the
 * older post must arrive *under* the ones already read. Written against the
 * contract the server now keeps (`items` plus `nextCursor`), so it fails if
 * either the cursor or the accumulation goes away.
 */
import { test, expect, type Page } from '@playwright/test';

const API = 'https://verification-test.supabase.co';

const person = (id: number, name: string) => ({
  id,
  name,
  username: name.toLowerCase().replace(/[^a-z]/g, ''),
  verified: false,
  photos: [],
});

const post = (id: number, body: string, author: ReturnType<typeof person>) => ({
  id,
  body,
  mediaUrl: null,
  mediaKind: null,
  edit: null,
  audience: 'everyone',
  circleId: null,
  createdAt: Date.now() - id * 60_000,
  author,
  mine: false,
  likeCount: 0,
  liked: false,
  commentCount: 0,
  saved: false,
});

const PAGE_ONE = Array.from({ length: 20 }, (_, i) => post(200 - i, `page one, post ${i + 1}`, person(9, 'Ada Nwosu')));
const PAGE_TWO = Array.from({ length: 5 }, (_, i) => post(180 - i, `page two, post ${i + 21}`, person(9, 'Ada Nwosu')));

async function signedIn(page: Page, opts: { withOwnPost?: boolean } = {}) {
  const profile = {
    id: 1,
    email: 'offline@example.com',
    name: 'Offline test',
    onboarded: true,
    status: 'active',
    birthdate: '1995-01-01',
    verification: 'none',
    created_at: Date.now(),
  };
  const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: profile.email };
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token =
    [
      { alg: 'HS256', typ: 'JWT' },
      { sub: user.id, aud: 'authenticated', role: 'authenticated', exp },
    ]
      .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url'))
      .join('.') + '.offline-signature';

  await page.addInitScript(
    ({ user, token, exp }) => {
      localStorage.setItem(
        'sb-verification-test-auth-token',
        JSON.stringify({ user, access_token: token, refresh_token: 'offline-refresh', token_type: 'bearer', expires_at: exp, expires_in: 3600 }),
      );
    },
    { user, token, exp },
  );

  /* The feed answers by cursor: no cursor is the first page, the first page's
     cursor is the second and last. Nothing else in the app is asked about. */
  /* One post written by the reader, newest first: Crushes carries your own
     posts now, and a card that is yours is the card with a Delete on it. */
  const ownPost = {
    ...post(300, 'mine, written by me', { id: 1, name: 'Offline test', username: 'offline', verified: false, photos: [] }),
    mine: true,
  };
  const firstPage = opts.withOwnPost ? [ownPost, ...PAGE_ONE.slice(0, 19)] : PAGE_ONE;

  const feedAnswer = (after: unknown) => {
    if (after == null) return { items: firstPage, nextCursor: 181 };
    return { items: PAGE_TWO, nextCursor: null };
  };

  await page.route(`${API}/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let body: unknown = {};
    if (path === '/auth/v1/user') body = user;
    else if (path === '/rest/v1/rpc/crush_posts_feed') {
      const sent = route.request().postDataJSON() as { p_after?: number | null } | null;
      body = feedAnswer(sent?.p_after ?? null);
    } else if (path === '/rest/v1/rpc/badges') body = { notifications: 0, whispers: 0, crushes: 0, moments: 0 };
    else if (path === '/rest/v1/rpc/flow_feed' || path === '/rest/v1/rpc/flow_ranked_feed') body = { items: [], hasMore: false };
    else if (path === '/rest/v1/rpc/my_circles') body = { items: [] };
    else if (path === '/rest/v1/rpc/circle_highlights') body = [];
    else if (path === '/rest/v1/rpc/heartbeat') body = true;
    else if (path === '/rest/v1/rpc/visible_moments' || path === '/rest/v1/rpc/moments_feed') body = { mine: null, others: [] };
    else if (path === '/rest/v1/profiles') body = profile;
    else if (path === '/rest/v1/photos') body = [];
    else if (path === '/rest/v1/crushes') body = [];
    else body = [];

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
      headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': '*' },
    });
  });
}

/** Press the pixels: a React Native Web tree replaces nodes faster than a click. */
async function pressText(page: Page, text: string) {
  const node = page.getByText(text, { exact: true }).first();
  await node.waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(800);
  const box = await node.boundingBox();
  if (!box) throw new Error(`${text} has no box`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(1200);
}

test('scrolling the all-crush feed adds the older page under the one already read', async ({ page }) => {
  await signedIn(page);
  await page.goto('/');
  await pressText(page, 'All Crush Feed');

  await expect(page.getByText('page one, post 1', { exact: true })).toBeVisible({ timeout: 30000 });

  /* Scroll to the end of the list the way a thumb does, until the second page
     has been asked for. Wheel events over the list are what a FlatList hears. */
  const feed = page.getByText('page one, post 1', { exact: true });
  const box = (await feed.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, 500);
  for (let i = 0; i < 40; i += 1) {
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(120);
  }

  // The older page arrived…
  await expect(page.getByText('page two, post 21', { exact: true })).toBeVisible({ timeout: 20000 });

  // …and the posts that were already on screen are still there, above it. This
  // is the assertion the old feed failed: it showed page two instead of page one.
  await expect(page.getByText('page two, post 25', { exact: true })).toBeVisible({ timeout: 20000 });
  await page.keyboard.press('Home');
  await page.mouse.wheel(0, -30000);
  await page.waitForTimeout(800);
  await expect(page.getByText('page one, post 1', { exact: true })).toBeVisible({ timeout: 20000 });

  await page.screenshot({ path: 'walk-web/crushes-paging.png', fullPage: false });
});

test('your own post is in the all-crush feed, and it is yours there', async ({ page }) => {
  await signedIn(page, { withOwnPost: true });
  await page.goto('/');
  await pressText(page, 'All Crush Feed');

  await expect(page.getByText('mine, written by me', { exact: true })).toBeVisible({ timeout: 30000 });
  // The one control that only ever appears on your own card.
  await expect(page.getByLabel('Delete post').first()).toBeVisible();

  await page.screenshot({ path: 'walk-web/crushes-own-post.png', fullPage: false });
});
