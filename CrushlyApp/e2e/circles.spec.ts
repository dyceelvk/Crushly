/**
 * Connections, offline: a room you are not in, drawn inside the feed.
 *
 * Every request is answered from this file, so the page is the same on every run
 * and nothing touches a real project. What is being checked is layout, and the
 * layout of this card is the whole feature: a discovery card that is taller than
 * the screen is a card whose button nobody can reach, and that is exactly the
 * kind of thing a screenshot cannot prove but a bounding box can.
 */
import { test, expect, type Page } from '@playwright/test';

const API = 'https://verification-test.supabase.co';

const CIRCLE = {
  id: 5,
  name: 'Sunday go sharp oh',
  about: 'The usual suspects, every Sunday.',
  theme: 'Music',
  coverUrl: null,
  createdAt: Date.now() - 86400000,
  ownerId: 2,
  ownerName: 'Riel Inc.',
  ownerUsername: 'thisisriel',
  ownerPhoto: null,
  memberCount: 2,
  capacity: 12,
  discoverable: true,
  joinPolicy: 'request',
  postsThisWeek: 0,
  messagesThisWeek: 0,
  posts: 0,
  messages: 0,
  friendsInside: 0,
  state: 'none',
};

async function signedIn(page: Page, notifications: unknown[] = []) {
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

  const rpcAnswer = (fn: string): unknown => {
    switch (fn) {
      case 'flow_feed':
      case 'flow_ranked_feed':
        return { items: [], hasMore: false };
      case 'badges':
        return { notifications: notifications.length, whispers: 0, crushes: 0, moments: 0 };
      case 'my_circles':
        return { items: [] };
      case 'circle_highlights':
        return [];
      case 'discover_circles':
        return [CIRCLE];
      case 'my_circle_invitations':
      case 'my_circle_requests':
        return [];
      case 'heartbeat':
        return true;
      // The bell reads one RPC; /rest/v1/notifications is not it.
      case 'list_notifications':
        return notifications;
      default:
        return [];
    }
  };

  await page.route(`${API}/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let body: unknown = {};
    if (path === '/auth/v1/user') body = user;
    else if (path.startsWith('/rest/v1/rpc/')) body = rpcAnswer(path.slice('/rest/v1/rpc/'.length));
    else if (path === '/rest/v1/profiles') body = profile;
    else if (path === '/rest/v1/photos') body = [];
    else if (path === '/rest/v1/verification_requests') body = null;
    else if (path === '/rest/v1/crushes') body = [];
    else if (path === '/rest/v1/notifications') body = notifications;
    else body = [];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
      headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': '*' },
    });
  });
}


/**
 * Open Connections the way a finger does.
 *
 * A React Native Web tree re-renders under you, and Playwright's actionability
 * checks then refuse to click a node that has already been replaced. The tab is
 * in the same place either way, so this presses the pixels.
 */
async function openConnections(page: Page) {
  await page.goto('/');
  const tab = page.getByText('Connections', { exact: true }).first();
  await tab.waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1500);
  const box = await tab.boundingBox();
  if (!box) throw new Error('the Connections tab has no box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(1200);
}

test('a room you are not in is offered inside Connections, and its card fits the screen', async ({ page }) => {
  await signedIn(page);
  await openConnections(page);

  const card = page.getByText('Circles you could join', { exact: true });
  await expect(card).toBeVisible({ timeout: 20000 });

  // The room is named, its owner is named, and it says how big it is.
  await expect(page.getByText('Sunday go sharp oh', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Riel Inc\./).first()).toBeVisible();
  await expect(page.getByText(/2\/12/).first()).toBeVisible();

  // And the one door is on the screen, not below it.
  const ask = page.getByRole('button', { name: 'Request to join', exact: true }).first();
  await expect(ask).toBeVisible();
  const box = await ask.boundingBox();
  const height = page.viewportSize()?.height ?? 844;
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThan(0);
  expect(box!.y).toBeLessThan(height - 40);

  await page.screenshot({ path: 'walk-web/connections-discovery.png', fullPage: false });
});

test('the composer sits above the feed, once', async ({ page }) => {
  await signedIn(page);
  await openConnections(page);
  await expect(page.getByText('Say something…', { exact: true })).toHaveCount(1);
});

/**
 * The other end of the same door. A request reaches the owner as a sentence
 * about a person and a room, and it opens the list where it can be answered —
 * the sentence is the contract, so it is what gets checked.
 */
test('a join request is announced by name, from the person to the room', async ({ page }) => {
  await signedIn(page, [
    {
      id: 91,
      kind: 'circle_request',
      body: 'Sunday go sharp oh',
      read: false,
      refId: 5,
      createdAt: Date.now() - 60000,
      actor: { id: 9, name: 'Ada Nwosu', photo: null },
    },
  ]);
  await openConnections(page);
  await page.getByLabel('Notifications').first().click({ force: true });
  // The sheet slides up; the sentence has to survive the animation.
  await expect(page.getByText('Ada Nwosu asked to join Sunday go sharp oh.', { exact: true })).toBeVisible({ timeout: 20000 });
  await page.screenshot({ path: 'walk-web/notification-request.png', fullPage: false });
});
