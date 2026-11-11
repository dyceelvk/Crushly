/**
 * The two Moments surfaces, offline.
 *
 * What is being checked here is not "a component rendered" — it is the two rules
 * the owner asked for:
 *
 *   - a Moment is a round picture in the Crushes feed and in Discover;
 *   - Discover shows **one card per person**, not one per Moment, so somebody who
 *     posted four times in an afternoon cannot push three other people off the row.
 *
 * Everything is mocked, so this runs against the local export and needs no
 * account. Screenshots land in `test-results/` for a human to look at.
 */
import { test, expect, type Page } from '@playwright/test';

const API = 'https://verification-test.supabase.co';
const MEDIA = 'https://crushly-media.dyceelvk.workers.dev';

const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'offline@example.com' };
const profile = {
  id: 1, email: user.email, name: 'Offline test', username: 'offline', bio: '', onboarded: true,
  status: 'active', birthdate: '1995-01-01', verification: 'none', created_at: Date.now(),
  intentions: [], interests: [], languages: [], lifestyle: {},
};

/** An 80×80 coral square, as bytes, so the circles have something to paint. */
const PHOTO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAFAAAABQCAIAAAABc2X6AAAAeElEQVR4nO3PQRHAIADAMEAhwlDM' +
  'ay62uy5R0M579viT9XXA2wzXGa4zXGe4znCd4TrDdYbrDNcZrjNcZ7jOcJ3hOsN1husM1xmuM1xn' +
  'uM5wneE6w3WG6wzXGa4zXGe4znCd4TrDdYbrDNcZrjNcZ7jOcJ3hOsN1Dx+sAnZPFLwyAAAAA' +
  'ElFTkSuQmCC', 'base64');

const person = (id: number, name: string) => ({ id, name, username: name.toLowerCase(), verified: false, photos: [] });

/** Four Moments for Ada, one for Ben — the shape that broke the old row. */
function moments() {
  const now = Date.now();
  const at = (id: number, userId: number, name: string, minutes: number, kind: 'text' | 'photo') => ({
    id, userId, kind, body: `${name} says ${id}`, mediaUrl: kind === 'photo' ? `${MEDIA}/m/moments/${id}.jpg` : null,
    style: 'noir', edit: null, durationMs: null, createdAt: now - minutes * 60_000,
    audience: 'everyone', expiresAt: now + 86_400_000, seen: false, myReaction: null,
    author: person(userId, name),
  });
  return [
    at(1, 2, 'Ada', 4, 'text'),
    at(2, 2, 'Ada', 12, 'photo'),
    at(3, 2, 'Ada', 30, 'text'),
    at(4, 2, 'Ada', 60, 'text'),
    at(5, 3, 'Ben', 20, 'photo'),
    at(6, 1, 'Offline test', 8, 'text'),
  ];
}

async function offline(page: Page) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token =
    [{ alg: 'HS256', typ: 'JWT' }, { sub: user.id, aud: 'authenticated', role: 'authenticated', exp }]
      .map((p) => Buffer.from(JSON.stringify(p)).toString('base64url'))
      .join('.') + '.offline-signature';

  await page.addInitScript(
    ({ user, token, exp }) =>
      localStorage.setItem(
        'sb-verification-test-auth-token',
        JSON.stringify({ user, access_token: token, refresh_token: 'offline-refresh', token_type: 'bearer', expires_at: exp, expires_in: 3600 }),
      ),
    { user, token, exp },
  );

  /* A real 80×80 PNG, not an empty body: an empty image is indistinguishable
     from a circle that failed to draw, and the screenshot is the assertion here. */
  await page.route(`${MEDIA}/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: PHOTO }),
  );

  const post = {
    id: 11, body: 'A published post', mediaUrl: null, mediaKind: null, audience: 'everyone',
    createdAt: Date.now(), author: person(3, 'Ben'), likeCount: 1, liked: false, commentCount: 0, saved: false, viewCount: 4,
  };

  await page.route(`${API}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = [];
    if (path === '/auth/v1/user') body = user;
    else if (path === '/rest/v1/profiles') body = profile;
    else if (path === '/rest/v1/photos') body = [];
    else if (path === '/rest/v1/preferences') body = { age_min: 18, age_max: 99, intentions: [], interests: [] };
    else if (path === '/rest/v1/privacy') body = { profile_visibility: 'everyone', discoverable: true, show_city: true };
    else if (path === '/rest/v1/notification_settings') body = {};
    else if (path === '/rest/v1/verification_requests') body = null;
    else if (path === '/rest/v1/rpc/visible_moments') body = moments();
    /* The Crushes ring asks a narrower question now — `moment_circles()` returns
       only people this member has met here. The mock answers both with the same
       list: what is being checked is how a circle is drawn, not who qualifies,
       and qualification is a database rule the RPC tests already cover. */
    else if (path === '/rest/v1/rpc/moment_circles') body = moments();
    else if (path === '/rest/v1/rpc/crush_posts_feed') body = { items: [post], nextCursor: null };
    else if (path === '/rest/v1/rpc/public_flow_feed') body = { items: [post] };
    else if (path === '/rest/v1/rpc/holup_app_settings') body = { callsEnabled: false, publicSharingEnabled: true, announcement: null };
    else if (path === '/rest/v1/rpc/list_notifications') body = [];
    else if (path === '/rest/v1/rpc/holup_trends') body = [];
    else if (path === '/rest/v1/rpc/holup_is_admin') body = false;
    else if (path === '/rest/v1/rpc/unread_counts') body = { messages: 0, notifications: 0 };
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  });
}

async function signedIn(page: Page) {
  await offline(page);
  await page.goto('/');
  await page.waitForTimeout(2500);

  /*
   * Three doors stand between a stored session and the feed: the splash (which
   * is a tap, not a route), the welcome screen's sign-in button, and whichever
   * of the two the app decides to show first when it already has a session. So
   * the loop presses whatever is in front of it and stops the moment the tabs
   * are on screen — a fixed sequence of clicks is what made this flaky.
   */
  // The pane is called All Crush Feed: it is every Crush, not a list of people.
  const home = page.getByText('All Crush Feed', { exact: true });
  const door = page.getByText(/already on holUpp/);
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await home.first().isVisible().catch(() => false)) break;
    if (await door.isVisible().catch(() => false)) await door.click().catch(() => {});
    else await page.mouse.click(195, 400);
    await page.waitForTimeout(1500);
  }
  await home.first().waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(1500);
}

test('All Crush Feed opens on live Moments as circles, one per person', async ({ page }) => {
  await signedIn(page);
  await page.screenshot({ path: 'test-results/crushes-moment-circles.png' });
  // Ada has four live Moments. She is still one circle, and the badge is the
  // only thing that says the other three are behind it.
  await expect(page.getByText('+3')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Ben', { exact: true }).first()).toBeVisible();

  /*
   * The circle is a picture of the Moment, not a label for it.
   *
   * Ben's Moment is a photograph, so his circle has to contain a decoded image —
   * the regression this guards against is a disc that is drawn but empty, which
   * looks identical to a Moment that failed to load. A written Moment is words,
   * and its text is asserted by the Discover test instead.
   */
  const painted = await page.evaluate(() =>
    [...document.querySelectorAll('img')].filter((i) => i.naturalWidth > 0).length,
  );
  expect(painted).toBeGreaterThan(0);

  // A written Moment shows its words inside the circle, not a caption under it.
  await expect(page.locator('text=Ada says 1').first()).toBeVisible();
});

test('Discover shows one Moment card per person, made of the Moment itself', async ({ page }) => {
  await signedIn(page);
  await page.getByText('Discovery', { exact: true }).first().click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'test-results/discover-moment-cards.png' });
  const momentsCard = page.getByText('+3');
  await expect(momentsCard).toBeVisible({ timeout: 20_000 });
  // One card for Ada, not four.
  await expect(page.locator('text=Ada says 1')).toHaveCount(1);
  /*
   * The card is the content, not content inside a frame.
   *
   * It spent a round with a round picture inside a coloured ring inside a card,
   * which is decoration around a face — the thing the owner kept rejecting. A
   * written Moment's words have to reach the edges of the card now, so the text
   * is measured against the card it sits in rather than trusted to sit anywhere.
   */
  const fits = await page.evaluate(() => {
    const label = [...document.querySelectorAll('div')].find((d) => d.textContent === 'Ada says 1');
    if (!label) return null;
    const card = label.closest('div[role="button"]') ?? label.parentElement?.parentElement;
    if (!card) return null;
    const l = label.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    return { inset: Math.round(l.left - c.left), cardW: Math.round(c.width) };
  });
  expect(fits).not.toBeNull();
  // Inside the card's own padding, not tucked into a circle half its width.
  expect(fits!.inset).toBeLessThan(fits!.cardW * 0.2);
});
