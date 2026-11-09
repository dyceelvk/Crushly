/** Offline browser checks: mock APIs; no real accounts or uploads. */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const API = 'https://verification-test.supabase.co';
const MEDIA = 'https://crushly-media.dyceelvk.workers.dev';
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64');
const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'offline@example.com' };
const profile = { id: 1, email: user.email, name: 'Offline test', username: 'offline', bio: 'My site https://example.com/about', onboarded: true, status: 'active', birthdate: '1995-01-01', verification: 'none', created_at: Date.now(), intentions: [], interests: [], languages: [], lifestyle: {} };
const person = { id: 2, name: 'Ada', username: 'ada', verified: false, photos: [], city: 'Lagos' };
const onePost = { id: 11, body: 'hello #holiday', mediaUrl: 'https://example.test/p.jpg', mediaKind: 'photo', audience: 'everyone', createdAt: Date.now(), author: person };
async function offline(page: Page, calls: Record<string, unknown>[], commentCalls: Record<string, unknown>[] = [], isAdmin = false, ranked = false, viewCalls: number[] = [], video = false) {
  let banner: string | null = null;
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: user.id, aud: 'authenticated', role: 'authenticated', exp }].map((p) => Buffer.from(JSON.stringify(p)).toString('base64url')).join('.') + '.offline-signature';
  await page.addInitScript(({ user, token, exp }) => localStorage.setItem('sb-verification-test-auth-token', JSON.stringify({ user, access_token: token, refresh_token: 'offline-refresh', token_type: 'bearer', expires_at: exp, expires_in: 3600 })), { user, token, exp });
  await page.route(`${MEDIA}/**`, async (route) => {
    if (new URL(route.request().url()).pathname.endsWith('.webm')) return route.fulfill({ status: 200, contentType: 'video/webm', headers: { 'access-control-allow-origin': '*' }, body: readFileSync(join(__dirname, 'test-clip.webm')) });
    if (route.request().method() === 'POST') return route.fulfill({ status: 201, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ url: `${MEDIA}/m/banners/1/test.jpg` }) });
    if (route.request().method() === 'DELETE') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: '{}' });
    return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: image });
  });
  await page.route(`${API}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = [];
    if (path === '/auth/v1/user') body = user;
    else if (path === '/rest/v1/profiles') body = profile;
    else if (path === '/rest/v1/preferences') body = { age_min: 18, age_max: 99, intentions: [], interests: [] };
    else if (path === '/rest/v1/privacy') body = { profile_visibility: 'everyone', discoverable: true, show_city: true };
    else if (path === '/rest/v1/notification_settings') body = {};
    else if (path === '/rest/v1/verification_requests') body = null;
    else if (path === '/rest/v1/rpc/space_banner') body = banner;
    else if (path === '/rest/v1/rpc/set_space_banner') { const old = banner; banner = (route.request().postDataJSON() as { p_url: string | null }).p_url; body = old; }
    else if (path === '/rest/v1/rpc/search_holup') {
      const params = route.request().postDataJSON() as Record<string, unknown>; calls.push(params);
      body = { members: params.p_category === 'top' || params.p_category === 'people' ? [person] : [], posts: ['top', 'photos'].includes(String(params.p_category)) ? [onePost] : [], moments: [], sounds: params.p_category === 'sounds' ? [{ id: 20, title: 'Holiday tune' }] : [], places: params.p_category === 'places' ? [{ name: 'Lagos' }] : [], hashtags: params.p_category === 'hashtags' ? [{ tag: 'holiday' }] : [] };
    }
    else if (path === '/rest/v1/rpc/holup_trends') body = [{ term: '#commentfixture', postCount: 2 }];
    else if (path === '/rest/v1/rpc/holup_is_admin') body = isAdmin;
    else if (path === '/rest/v1/rpc/holup_app_settings') body = { callsEnabled: false, publicSharingEnabled: true, announcement: null };
    else if (path === '/rest/v1/rpc/holup_admin_state') body = { features: { calls: false, public_post_sharing: true }, announcement: { title: '', body: '', active: false } };
    else if (path === '/rest/v1/rpc/holup_admin_analytics') body = { members: 4, seenLast7Days: 2, newMembersLast7Days: 1, postsLast7Days: 3, reactionsLast7Days: 2, commentsLast7Days: 1, whispersLast7Days: 1, openReports: 1 };
    else if (path === '/rest/v1/rpc/holup_admin_set_feature') body = true;
    else if (path === '/rest/v1/rpc/holup_admin_reports') body = [{ id: 81, reporterId: 2, reporterName: 'Reporter', reportedId: 3, reportedName: 'Reported', reason: 'other', details: 'Report details', context: 'profile', handled: false, createdAt: Date.now() }];
    else if (path === '/rest/v1/rpc/public_post_preview') body = { id: 11, body: onePost.body, author: person.name };
    else if (path === '/rest/v1/rpc/record_post_view') { viewCalls.push(Number((route.request().postDataJSON() as {p_post_id: number}).p_post_id)); body = { recorded: true }; }
    else if (path === '/rest/v1/rpc/post_viewers') body = { items: [{ profile: person, viewedAt: Date.now() }] };
    else if (path === '/rest/v1/rpc/load_post') { const id = Number((route.request().postDataJSON() as {p_post_id: number}).p_post_id); body = { ...onePost, id, body: ranked ? `Pager item ${id}` : onePost.body, mediaUrl: video ? `${MEDIA}/m/posts/${id}.webm` : null, mediaKind: video ? 'video' : null, edit: null, circleId: null, mine: id === 12, likeCount: 0, liked: false, commentCount: 1, saved: false, viewCount: 2 }; }
    else if (path === '/rest/v1/rpc/edit_post') { const args = route.request().postDataJSON() as Record<string, unknown>; commentCalls.push(args); body = { ...onePost, id: 12, audience: args.p_audience, body: args.p_body, mediaUrl: null, mediaKind: null, edit: null, circleId: null, mine: true, likeCount: 0, liked: false, commentCount: 1, viewCount: 2 }; }
    else if (path === '/rest/v1/rpc/post_comment_settings') body = true;
    else if (path === '/rest/v1/rpc/post_likers') body = { items: [] };
    else if (path === '/rest/v1/rpc/post_comments_feed') body = { items: [{ id: 45, body: 'Hello there', createdAt: Date.now(), mine: false, author: person, parentId: null, liked: false, likeCount: 0 }, { id: 47, body: 'See https://example.com/comment.', createdAt: Date.now(), mine: false, author: person, parentId: null, liked: false, likeCount: 0 }] };
    else if (path === '/rest/v1/rpc/comment_on_post') { commentCalls.push(route.request().postDataJSON() as Record<string, unknown>); body = { id: 46 }; }
    else if (path === '/rest/v1/rpc/badges') body = { notifications: 0, whispers: 0, crushes: 0, moments: 0 };
    else if (path === '/rest/v1/rpc/crush_posts_feed') body = { items: [{ ...onePost, mediaUrl: null, mediaKind: null, edit: null, circleId: null, mine: false, likeCount: 0, liked: false, commentCount: 1, saved: false }], nextCursor: null };
    else if (path === '/rest/v1/rpc/space_posts') body = { items: [], nextCursor: null };
    else if (path === '/rest/v1/rpc/flow_feed' || path === '/rest/v1/rpc/flow_ranked_feed') body = { items: ranked ? [11, 12, 13].map((id) => ({ ...onePost, id, body: `Pager item ${id}`, mediaUrl: video ? `${MEDIA}/m/posts/${id}.webm` : null, mediaKind: video ? 'video' : null, mine: id === 12, likeCount: 0, liked: false, commentCount: 0, viewCount: 2 })) : [], nextCursor: null };
    else if (path === '/rest/v1/rpc/my_circles') body = { items: [] };
    else if (path === '/rest/v1/rpc/heartbeat') body = true;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': '*' } });
  });
}
test('search categories, filters and result routes work on a phone-sized web screen', async ({ page }) => {
  const calls: Record<string, unknown>[] = []; await offline(page, calls); await page.goto('/');
  await page.getByRole('button', { name: 'Search Holup' }).first().click({ timeout: 30000 });
  await page.getByPlaceholder('Search Holup').fill('holiday');
  for (const label of ['Top', 'Clips', 'Photos', 'People', 'Sounds', 'Places', 'Hashtags', 'Moments']) {
    const tab = page.getByRole('tab', { name: label, exact: true }); await expect(tab).toBeVisible(); await tab.click();
    await expect.poll(() => calls.at(-1)?.p_category).toBe(label.toLowerCase());
  }
  await page.getByRole('tab', { name: 'Places', exact: true }).click();
  await page.getByRole('button', { name: 'People in Lagos' }).click();
  await expect.poll(() => calls.at(-1)?.p_place).toBe('Lagos');
  await page.getByPlaceholder('Search Holup').fill('holiday');
  await page.getByRole('tab', { name: 'Hashtags', exact: true }).click();
  await page.getByRole('button', { name: 'Search hashtag holiday' }).click();
  await expect.poll(() => calls.at(-1)?.p_hashtag).toBe(true);
  await page.getByRole('button', { name: 'Search options' }).click();
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole('checkbox', { name: 'Past week' }).click();
  await page.getByRole('checkbox', { name: 'Newest' }).click();
  await page.getByLabel('Author name or username').fill('Ada');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect.poll(() => calls.at(-1)?.p_author).toBe('Ada');
  expect(calls.at(-1)?.p_sort).toBe('newest');
  expect(Number(calls.at(-1)?.p_since)).toBeGreaterThan(Date.now() - 8 * 86400000);
});
test('banner chooser uploads and removes a separate banner without changing profile photos', async ({ page }) => {
  await offline(page, []); await page.goto('/');
  await page.getByText('Space', { exact: true }).last().click({ timeout: 30000 });
  await page.getByRole('button', { name: 'Edit Space' }).click();
  await expect(page.getByText('Space banner', { exact: true })).toBeVisible();
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Add banner' }).click();
  await (await chooser).setFiles({ name: 'banner.png', mimeType: 'image/png', buffer: image });
  await expect(page.getByRole('button', { name: 'Change banner' })).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Remove banner' }).click();
  await page.getByRole('button', { name: 'Remove banner', exact: true }).last().click();
  await expect(page.getByRole('button', { name: 'Add banner' })).toBeVisible({ timeout: 20000 });
});


test('filters keep the Apply control on a short phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await offline(page, []); await page.goto('/');
  await page.getByRole('button', { name: 'Search Holup' }).first().click({ timeout: 30000 });
  await page.getByRole('button', { name: 'Search options' }).click();
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.waitForTimeout(500);
  const apply = page.getByRole('button', { name: 'Apply filters' });
  const bounds = await apply.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(640);
});


test('comments remain text-only with replies, emoji and mentions', async ({ page }) => {
  const sent: Record<string, unknown>[] = [];
  await offline(page, [], sent); await page.goto('/');
  await page.getByText('Crushes', { exact: true }).first().click({ timeout: 30000 });
  await page.getByRole('button', { name: /Comments, 1 comment/ }).first().click();
  await expect(page.getByText('Hello there', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reply', exact: true }).first().click();
  await page.getByLabel('Add a comment').fill('Thanks');
  await page.getByRole('button', { name: 'Emoji' }).click();
  await page.getByRole('button', { name: 'Add ✨' }).click();
  await page.getByRole('button', { name: 'Send comment' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].p_parent_id).toBe(45);
  expect(sent[0].p_body).toBe('Thanks✨');
  await page.getByRole('button', { name: 'Mention somebody' }).click();
  await expect(page.getByLabel('Add a comment')).toHaveValue('@');
  await expect(page.getByRole('button', { name: /attach photo|voice comment/i })).toHaveCount(0);
});


test('trends from comments lead to real searches', async ({ page }) => {
  const calls: Record<string, unknown>[] = []; await offline(page, calls); await page.goto('/');
  await page.getByRole('button', { name: 'Search Holup' }).first().click({ timeout: 30000 });
  await page.getByRole('button', { name: 'Search #commentfixture' }).click();
  await expect.poll(() => calls.at(-1)?.p_query).toBe('commentfixture');
  expect(calls.at(-1)?.p_hashtag).toBe(true);
});

test('a web post link opens after authentication and shows count only to non-owner', async ({ page }) => {
  await offline(page, []); await page.goto('/?post=11');
  await expect(page.getByText('hello #holiday').last()).toBeVisible({ timeout: 30000 });
  await expect(page.getByLabel('2 views', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /see viewers/i })).toHaveCount(0);
});

test('owner can open the viewer list', async ({ page }) => {
  await offline(page, []); await page.goto('/?post=12');
  await page.getByRole('button', { name: '2 views, see viewers' }).click({ timeout: 30000 });
  await expect(page.getByText('Only you can see who viewed this.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Ada’s Space' })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
});

test('verified admin can access the server-backed feature controls', async ({ page }) => {
  await offline(page, [], [], true); await page.goto('/');
  await page.getByText('Space', { exact: true }).last().click({ timeout: 30000 });
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByText('Holup admin', { exact: true }).click();
  await expect(page.getByText('Operations and controls')).toBeVisible();
  await expect(page.getByText('Seen in last 7 days')).toBeVisible();
  await page.getByRole('tab', { name: 'Action board', exact: true }).click();
  await expect(page.getByLabel('Voice calls', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Public post links', { exact: true })).toBeVisible();
  await page.getByLabel('Title', { exact: true }).fill('Draft announcement');
  await page.getByLabel('Public post links', { exact: true }).click();
  await page.waitForTimeout(500);
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Draft announcement');
  await page.getByRole('tab', { name: 'Reports', exact: true }).click();
  await expect(page.getByText('Report details')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark reviewed' })).toBeVisible();
});


test('a post owner can select Private while editing', async ({ page }) => {
  const calls: Record<string, unknown>[] = []; await offline(page, [], calls); await page.goto('/?post=12');
  await page.getByRole('button', { name: 'More for this post' }).click({ timeout: 30000 });
  await page.getByText('Edit the words', { exact: true }).click();
  await page.getByText('Private', { exact: true }).last().click();
  await page.getByRole('button', { name: 'Save this post' }).click();
  await expect.poll(() => calls.some((call) => call.p_audience === 'private')).toBe(true);
});

test('external sharing copies a real public post URL', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await offline(page, []); await page.goto('/?post=11');
  await page.getByRole('button', { name: 'Share this post' }).first().click({ timeout: 30000 });
  await page.getByRole('button', { name: 'Copy post link' }).click();
  await expect(page.getByText('Link copied')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('https://holupapp.vercel.app/v/11');
});


test('Flow full-screen pager moves forwards and backwards', async ({ page }) => {
  const views: number[] = []; await offline(page, [], [], false, true, views); await page.goto('/?post=11');
  await expect(page.getByText('Pager item 11').last()).toBeVisible({ timeout: 30000 });
  await expect.poll(() => views.includes(11), { timeout: 10000 }).toBe(true);
  expect(views).not.toContain(13);
  await page.mouse.move(190, 420); await page.mouse.wheel(0, 850);
  await expect.poll(async () => page.getByText('Pager item 12').last().evaluate(el => { const r=el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), { timeout: 10000 }).toBe(true);
  await page.mouse.wheel(0, 850);
  await expect.poll(async () => page.getByText('Pager item 13').last().evaluate(el => { const r=el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), { timeout: 10000 }).toBe(true);
  await expect.poll(() => views.includes(13), { timeout: 10000 }).toBe(true);
  expect(views).not.toContain(12); // owner's own post is never counted
  await page.mouse.wheel(0, -850);
  await expect.poll(async () => page.getByText('Pager item 12').last().evaluate(el => { const r=el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), { timeout: 10000 }).toBe(true);
});


test('ordinary members do not see an admin entry', async ({ page }) => {
  await offline(page, []); await page.goto('/');
  await page.getByText('Space', { exact: true }).last().click({ timeout: 30000 });
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText('Account & security')).toBeVisible();
  await expect(page.getByText('Holup admin', { exact: true })).toHaveCount(0);
});


test('active Flow video plays and stops when moving to the next page', async ({ page }) => {
  await offline(page, [], [], false, true, [], true); await page.goto('/?post=11');
  const state = async () => page.locator('video').evaluateAll((items) => items.map((e) => ({src: e.currentSrc || e.src, paused: e.paused, time: e.currentTime, fit: getComputedStyle(e).objectFit})));
  await expect.poll(async () => (await state()).some(v => v.src.includes('/11.webm') && v.fit === 'contain' && !v.paused && v.time > 0.2), { timeout: 20000 }).toBe(true);
  await page.mouse.move(190, 420); await page.mouse.wheel(0, 850);
  await expect.poll(async () => (await state()).some(v => v.src.includes('/12.webm') && v.fit === 'contain' && !v.paused && v.time > 0.2), { timeout: 20000 }).toBe(true);
  await expect.poll(async () => (await state()).filter(v => v.src.includes('/11.webm')).every(v => v.paused), { timeout: 10000 }).toBe(true);
  expect((await state()).filter(v => v.src.includes('/12.webm')).some(v => v.fit === 'contain')).toBe(true);
});


test('Space bio link opens inside Holup and own Space link copies from three dots', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await offline(page, []); await page.goto('/');
  await page.getByText('Space', { exact: true }).last().click({ timeout: 30000 });
  const bioLink = page.getByRole('link', { name: /Open link to example.com\/about inside Holup/ }).first();
  await expect(bioLink).toBeVisible({ timeout: 30000 });
  await bioLink.click();
  await expect(page.getByText('Inside Holup', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close preview' }).click();
  await page.getByRole('button', { name: 'More Space options' }).click();
  await page.getByRole('button', { name: 'Copy Space link' }).click();
  await expect(page.getByText('Link copied')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('https://holupapp.vercel.app/?space=1');
});

test('comment link closes sheet and opens inside Holup without punctuation', async ({ page }) => {
  await offline(page, []); await page.goto('/');
  await page.getByText('Crushes', { exact: true }).first().click({ timeout: 30000 });
  await page.getByRole('button', { name: /Comments, 1 comment/ }).first().click();
  await page.getByRole('link', { name: 'Open link to example.com/comment inside Holup' }).click();
  await expect(page.getByText('Inside Holup', { exact: true })).toBeVisible();
  await expect(page.locator('iframe[title="Link preview"]')).toHaveAttribute('src', 'https://example.com/comment');
});

test('post composer link control inserts a web address', async ({ page }) => {
  await offline(page, []); await page.goto('/');
  await page.getByRole('button', { name: 'Create post' }).first().click({ timeout: 30000 });
  await page.getByRole('button', { name: /Post\. Words, photos and clips/ }).click();
  await page.getByRole('button', { name: 'Add link to post' }).click();
  await page.getByLabel('Web address').fill('example.com/path');
  await page.getByRole('button', { name: 'Add link', exact: true }).click();
  await expect(page.getByPlaceholder('Good energy, better days. Same me, just more focused.')).toHaveValue('https://example.com/path');
});
