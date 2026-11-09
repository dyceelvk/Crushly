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
    else if (path === '/rest/v1/rpc/holup_admin_set_feature') body = true;
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
    else if (path === '/rest/v1/rpc/v3_keep_stats') body = { keeps: false, keepsYou: false, keptClose: 0, keeping: 0, canViewKeptClose: false };
    else if (path === '/rest/v1/rpc/v3_keep_people') body = { items: [], hasMore: false };
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
  await expect(page.getByText('Feature controls and announcements')).toBeVisible();
  await expect(page.getByLabel('Voice calls', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Public post links', { exact: true })).toBeVisible();
  await page.getByLabel('Title', { exact: true }).fill('Draft announcement');
  await page.getByLabel('Public post links', { exact: true }).click();
  await page.waitForTimeout(500);
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Draft announcement');
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

test('manual post location is saved next to link control and sent with post', async ({ page }) => {
  await offline(page, []);
  let submitted: Record<string, unknown> | null = null;
  await page.route(`${API}/rest/v1/rpc/create_post_with_location`, async (route) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ...onePost, id: 92, location: submitted.p_location }) });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Create post' }).first().click({ timeout: 30000 });
  await page.getByRole('button', { name: /Post\. Words, photos and clips/ }).click();
  const location = page.getByRole('button', { name: 'Add post location' });
  const link = page.getByRole('button', { name: 'Add link to post' });
  await expect(location).toBeVisible(); await expect(link).toBeVisible();
  const a = await location.boundingBox(); const b = await link.boundingBox();
  expect(a && b && b.x > a.x && Math.abs(b.y-a.y) < 5).toBeTruthy();
  await location.click(); await page.getByLabel('Place name').fill('Port Harcourt');
  await page.getByRole('button', { name: 'Save location' }).click();
  await expect(page.getByText('Port Harcourt', { exact: true })).toBeVisible();
  await page.getByPlaceholder('Good energy, better days. Same me, just more focused.').fill('Hello');
  await page.getByRole('button', { name: 'Publish your post' }).click();
  await expect.poll(() => submitted?.p_location).toBe('Port Harcourt');
});

test('Whisper links open inside the app and both deletion choices call the server', async ({ page }) => {
  await offline(page, []);
  const peer = { id: 2, name: 'Ada', verified: false, photo: null, online: false };
  let messages = [
    { id: 301, conversationId: 5, senderId: 1, mine: true, kind: 'text', body: 'Mine https://example.com/whisper', mediaUrl: null, meta: {}, createdAt: Date.now(), readAt: null, reactions: [] },
    { id: 302, conversationId: 5, senderId: 2, mine: false, kind: 'text', body: 'Their message', mediaUrl: null, meta: {}, createdAt: Date.now(), readAt: null, reactions: [] },
  ];
  const deleted: Record<string, unknown>[] = [];
  await page.route(`${API}/rest/v1/rpc/*`, async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    const args = route.request().postDataJSON() as Record<string, any>;
    let body: unknown;
    if (name === 'list_conversations') body = { items: [{ id: 5, peer, lastMessage: messages[messages.length-1] ?? null, unread: 0, updatedAt: Date.now() }] };
    else if (name === 'load_conversation') body = { id: 5, closed: false, peer, canSend: true, blockReason: null };
    else if (name === 'get_messages') body = { items: args.p_after_id ? messages.filter(m => m.id > args.p_after_id) : messages, hasMore: false, lastReadMine: null };
    else if (name === 'sync_whispers') body = messages.filter(m => args.p_ids.includes(m.id));
    else if (name === 'delete_whisper') { deleted.push(args); messages = messages.filter(m => m.id !== args.p_message_id); body = true; }
    else if (name === 'mark_messages_delivered') body = { upTo: 0, count: 0 };
    else if (name === 'peer_presence') body = { peerId: 2, online: false, activity: null, receipts: false, announce: false, closed: false };
    else return route.fallback();
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  });
  await page.goto('/');
  await page.getByText('Whispers', { exact: true }).last().click({ timeout: 30000 });
  await page.getByRole('button', { name: /Ada\. Their message/ }).click();
  await page.getByRole('link', { name: /Open link to example.com\/whisper inside Holup/ }).click();
  await expect(page.getByText('Inside Holup', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close preview' }).click();
  const mine = page.getByRole('button', { name: /You: Mine/ });
  await mine.hover(); await page.mouse.down(); await page.waitForTimeout(500); await page.mouse.up();
  await page.getByRole('button', { name: 'Delete Whisper for everyone' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(() => deleted.length).toBe(1);
  expect(deleted[0]).toMatchObject({ p_message_id: 301, p_everyone: true });
  await expect(mine).toHaveCount(0);
  const theirs = page.getByRole('button', { name: /Ada: Their message/ });
  await theirs.hover(); await page.mouse.down(); await page.waitForTimeout(500); await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Delete Whisper for everyone' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete Whisper for me' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(() => deleted.length).toBe(2);
  expect(deleted[1]).toMatchObject({ p_message_id: 302, p_everyone: false });
});

test('notifications are a full screen with Holup and categorized activity', async ({ page }) => {
  await offline(page, []);
  const actor = { id: 2, name: 'Ada', verified: false, photo: null };
  const notes = [
    { id: 701, kind: 'message', body: '', refId: 5, createdAt: Date.now(), read: true, actor },
    { id: 702, kind: 'post_comment', body: 'Great post', refId: 11, createdAt: Date.now(), read: true, actor },
    { id: 703, kind: 'keep', body: 'request', refId: null, createdAt: Date.now(), read: true, actor },
    { id: 704, kind: 'verified', body: '', refId: null, createdAt: Date.now(), read: true, actor: null },
  ];
  await page.route(`${API}/rest/v1/rpc/list_notifications`, async (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(notes) }));
  await page.route(`${API}/rest/v1/rpc/holup_app_settings`, async (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ callsEnabled:false, publicSharingEnabled:true, announcement:{title:'Real announcement',body:'A message from Holup.'} }) }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Notifications', exact: true }).click({ timeout: 30000 });
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  await page.getByRole('tab', { name: 'Whispers', exact: true }).click();
  await expect(page.getByText('Ada sent you a Whisper.')).toBeVisible();
  await expect(page.getByText('Ada commented on your post.')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Post activity' }).click();
  await expect(page.getByText('Ada commented on your post.')).toBeVisible();
  await expect(page.getByText('Ada sent you a Whisper.')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Kept Close' }).click();
  await expect(page.getByText('Ada Kept you Close.')).toBeVisible();
  await page.getByRole('tab', { name: 'From Holup' }).click();
  await expect(page.getByText('Real announcement').last()).toBeVisible();
  await expect(page.getByText('Your Space is verified.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Notification settings' })).toBeVisible();
});

test('Space relationship totals open real lists and owner can choose list privacy', async ({ page }) => {
  await offline(page, []);
  let visibility = 'private';
  let submitted = '';
  await page.route(`${API}/rest/v1/rpc/space_relationship_stats`, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ addUps: 1, keptClose: 1, canViewAddUps: true, canViewKeptClose: true, addUpVisibility: visibility }), headers: { 'access-control-allow-origin': '*' } }));
  await page.route(`${API}/rest/v1/rpc/space_relationship_people`, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [person], hasMore: false }), headers: { 'access-control-allow-origin': '*' } }));
  await page.route(`${API}/rest/v1/rpc/v3_keep_stats`, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ keeps: false, keepsYou: false, keeping: 0, keptClose: 1, canViewKeptClose: true }), headers: { 'access-control-allow-origin': '*' } }));
  await page.route(`${API}/rest/v1/rpc/set_add_up_list_visibility`, route => { submitted = (route.request().postDataJSON() as { p_visibility: string }).p_visibility; visibility = submitted; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(visibility), headers: { 'access-control-allow-origin': '*' } }); });
  await page.goto('/');
  await page.getByText('Space', { exact: true }).last().click({ timeout: 30000 });
  await page.getByRole('button', { name: '1 Add Ups. View people' }).click();
  await expect(page.getByRole('button', { name: 'Open Ada’s Space' })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  await page.getByRole('button', { name: 'More Space options' }).click();
  await page.getByRole('button', { name: 'Who can see my Add Ups' }).click();
  await page.getByRole('button', { name: 'Approved Keep Close members' }).click();
  await expect.poll(() => submitted).toBe('close');
  await expect(page.getByText('Add Up list privacy updated')).toBeVisible();
});

test('Space Add Up and immediate Keep Close subscriptions are independent', async ({ page }) => {
  await offline(page, []);
  let followed = false, kept = false;
  const calls: string[] = [];
  const reply = (value: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(value), headers: { 'access-control-allow-origin': '*' } });
  const currentProfile = () => ({ ...person, acceptsCrushes: true, canMessage: true, messageBlockReason: null, crush: { sent: followed, sentStatus: followed ? 'pending' : null, received: false, mutual: false }, moments: [] });
  const currentKeep = () => ({ keeps: kept, keepsYou: false, keeping: 0, keptClose: kept ? 1 : 0, canViewKeptClose: kept });
  await page.route(`${API}/rest/v1/rpc/load_profile`, route => route.fulfill(reply(currentProfile())));
  await page.route(`${API}/rest/v1/rpc/v3_keep_stats`, route => route.fulfill(reply(currentKeep())));
  await page.route(`${API}/rest/v1/rpc/space_relationship_stats`, route => route.fulfill(reply({ addUps: followed ? 1 : 0, keptClose: 0, canViewAddUps: false, canViewKeptClose: false, addUpVisibility: null })));
  await page.route(`${API}/rest/v1/rpc/crush_member`, route => { calls.push('add'); followed = true; return route.fulfill(reply({ mutual: false, isNew: true, request: 'following', profile: currentProfile() })); });
  await page.route(`${API}/rest/v1/rpc/uncrush_member`, route => { calls.push('unfollow'); followed = false; return route.fulfill(reply(true)); });
  await page.route(`${API}/rest/v1/rpc/v3_keep_subscribe`, route => { calls.push('keep'); kept = true; return route.fulfill(reply(currentKeep())); });
  await page.goto('/?space=2');
  await expect(page.getByRole('button', { name: 'Add up with Ada' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Whisper Ada', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add up with Ada' }).click();
  await expect(page.getByRole('button', { name: 'Remove Add Up for Ada' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep Ada close' }).click();
  await expect(page.getByRole('button', { name: 'Stop keeping Ada close' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove Add Up for Ada' }).click();
  await expect(page.getByRole('button', { name: 'Add up with Ada' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop keeping Ada close' })).toBeVisible();
  expect(calls).toEqual(['add', 'keep', 'unfollow']);
});

test('Keep Close subscription hub is reachable and pages through subscribers', async ({ page }) => {
  await offline(page, []);
  const offsets: number[] = [];
  const reply = (value: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(value), headers: { 'access-control-allow-origin': '*' } });
  await page.route(`${API}/rest/v1/rpc/crushes_feed`, route => route.fulfill(reply({ incoming: [], outgoing: [], mutual: [], requestCount: 0 })));
  await page.route(`${API}/rest/v1/rpc/list_conversations`, route => route.fulfill(reply({ items: [] })));
  await page.route(`${API}/rest/v1/rpc/v3_keep_people`, route => {
    const body = route.request().postDataJSON() as { p_offset: number; p_direction: string };
    offsets.push(body.p_offset);
    const member = body.p_offset === 0 ? person : { ...person, id: 3, name: 'Tobi', username: 'tobi' };
    return route.fulfill(reply({ items: [{ profile: member, at: Date.now() }], hasMore: body.p_offset === 0 }));
  });
  await page.goto('/');
  await page.getByText('Whispers', { exact: true }).last().click({ timeout: 30000 });
  await page.getByRole('button', { name: 'Keep Close people' }).click();
  await expect(page.getByRole('heading', { name: 'Keep Close' })).toBeVisible();
  await expect(page.getByText('Ada', { exact: true }).last()).toBeVisible();
  await page.getByRole('button', { name: 'Show more' }).click();
  await expect(page.getByText('Tobi', { exact: true }).last()).toBeVisible();
  expect(offsets).toContain(1);
});

for (const own of [false, true]) {
  test(`Whisper opens the exact ${own ? 'owner’s' : 'sender’s'} replied Moment and rechecks unavailable targets`, async ({ page }) => {
    await offline(page, []);
    const peer = { id: 2, name: 'Ada', verified: false, photo: null, online: false };
    const author = own ? { id: 1, name: 'Offline test', verified: false, photo: null, mutual: false } : { ...peer, mutual: false };
    const moment = (id: number, text: string) => ({ id, userId: author.id, kind: 'text', body: text, mediaUrl: null, style: 'noir', audience: 'everyone', createdAt: Date.now() - 10000, expiresAt: Date.now() + 3600000, seen: false, myReaction: null, author });
    const msg = { id: 331, conversationId: 5, senderId: own ? 2 : 1, mine: !own, kind: 'moment_reply', body: 'Lovely reply', mediaUrl: null, meta: { momentId: 999, momentBody: 'old snapshot should stay hidden' }, createdAt: Date.now(), readAt: null, reactions: [] };
    let available = true;
    let failFeed = false;
    const targetCalls: number[] = [];
    await page.route(`${API}/rest/v1/rpc/*`, async route => {
      const name = new URL(route.request().url()).pathname.split('/').pop();
      const args = route.request().postDataJSON() as Record<string, any>;
      let body: unknown;
      if (name === 'list_conversations') body = { items: [{ id: 5, peer, lastMessage: msg, unread: 0, updatedAt: Date.now() }] };
      else if (name === 'load_conversation') body = { id: 5, closed: false, peer, canSend: true, blockReason: null };
      else if (name === 'get_messages') body = { items: args.p_after_id ? [] : [msg], hasMore: false, lastReadMine: null };
      else if (name === 'sync_whispers') body = [msg];
      else if (name === 'whisper_moment_target') { targetCalls.push(Number(args.p_message_id)); body = available ? { momentId: 62, userId: author.id, mine: own } : null; }
      else if (name === 'visible_moments') {
        if (failFeed) return route.fulfill({ status: 403, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ message: 'Not available' }) });
        body = [moment(61, 'First Moment, not the target'), moment(62, 'Exact replied Moment')];
      }
      else if (name === 'view_moment') body = true;
      else if (name === 'mark_messages_delivered') body = { upTo: 0, count: 0 };
      else if (name === 'peer_presence') body = { peerId: 2, online: false, activity: null, receipts: false, announce: false, closed: false };
      else return route.fallback();
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    });
    await page.goto('/');
    await page.getByText('Whispers', { exact: true }).last().click({ timeout: 30000 });
    await page.getByRole('button', { name: /Ada\..*replied/i }).click();
    await expect(page.getByText('old snapshot should stay hidden')).toHaveCount(0);
    await page.getByRole('button', { name: 'View replied Moment' }).click();
    await expect(page.getByText('Exact replied Moment', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('First Moment, not the target', { exact: true })).toHaveCount(0);
    expect(targetCalls).toEqual([331]);
    await page.getByRole('button', { name: 'Close Moments' }).click();
    available = false;
    await page.getByRole('button', { name: 'View replied Moment' }).click();
    await expect(page.getByText('This Moment isn’t available', { exact: true })).toBeVisible();
    await expect(page.getByText('Exact replied Moment', { exact: true })).toHaveCount(0);
    expect(targetCalls).toEqual([331, 331]);
    // A cached earlier feed must not turn a failed refresh into a stale Moment.
    available = true; failFeed = true;
    await page.getByRole('button', { name: 'View replied Moment' }).click();
    await expect(page.getByText('Couldn’t load Moments', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Exact replied Moment', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  });
}

test('revoked Whisper clears cached history and ignores an older in-flight fetch', async ({ page }) => {
  await offline(page, []);
  const peer = { id: 2, name: 'Ada', verified: false, photo: null, online: false };
  const msg = { id: 301, conversationId: 5, senderId: 2, mine: false, kind: 'text', body: 'Private history', mediaUrl: null, meta: {}, createdAt: Date.now(), readAt: null, reactions: [] };
  const late = { ...msg, id: 302, body: 'Outdated response' };
  let revoked = false, delayedFinished = false;
  await page.route(`${API}/rest/v1/rpc/*`, async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    const args = route.request().postDataJSON() as Record<string, any>;
    let body: unknown;
    if (name === 'list_conversations') body = { items: [{ id: 5, peer, lastMessage: msg, unread: 0, updatedAt: Date.now() }] };
    else if (name === 'load_conversation') body = { id: 5, closed: false, peer, canSend: true, blockReason: null };
    else if (name === 'get_messages') {
      if (revoked && args.p_after_id) { await new Promise(resolve => setTimeout(resolve, 1500)); delayedFinished = true; body = { items: [late], hasMore: false, lastReadMine: null }; }
      else body = { items: args.p_after_id ? [] : [msg], hasMore: false, lastReadMine: null };
    } else if (name === 'sync_whispers' && revoked) {
      return route.fulfill({ status: 400, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ code: 'P0001', message: '__CRUSHLY__404____Conversation not found.' }) });
    } else if (name === 'sync_whispers') body = [msg];
    else if (name === 'mark_messages_delivered') body = { upTo: 0, count: 0 };
    else if (name === 'peer_presence') body = { peerId: 2, online: false, activity: null, receipts: false, announce: false, closed: false };
    else return route.fallback();
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  });
  await page.goto('/');
  await page.getByText('Whispers', { exact: true }).last().click({ timeout: 30000 });
  await page.getByRole('button', { name: /Ada\. Private history/ }).click();
  await expect(page.getByRole('button', { name: /Ada: Private history/ })).toBeVisible();
  revoked = true;
  // The real safety poll runs every 20 seconds; sync refuses while an older
  // incremental result is still in flight.
  await expect(page.getByText('This Whisper is no longer available.').first()).toBeVisible({ timeout: 30000 });
  await expect.poll(() => delayedFinished, { timeout: 10000 }).toBe(true);
  await expect(page.getByRole('button', { name: /Ada: Private history/ })).toHaveCount(0);
  await expect(page.getByText('Outdated response', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Whisper', { exact: true })).toHaveCount(0);
  revoked = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('button', { name: /Ada: Private history/ })).toBeVisible();
});

for (const decision of ['accept', 'decline'] as const) {
  test(`Whisper requests inbox opens and ${decision}s a request`, async ({ page }) => {
    await offline(page, []);
    const peer = { id: 2, name: 'Ada', verified: false, photo: null, online: false };
    const msg = { id: 301, conversationId: 5, senderId: 2, mine: false, kind: 'text', body: 'Hello request', mediaUrl: null, meta: {}, createdAt: Date.now(), readAt: null, reactions: [] };
    let state: 'pending' | 'accepted' | 'declined' = 'pending';
    const calls: string[] = [];
    await page.route(`${API}/rest/v1/rpc/*`, async (route) => {
      const name = new URL(route.request().url()).pathname.split('/').pop();
      const args = route.request().postDataJSON() as Record<string, any>;
      let body: unknown;
      if (name === 'list_conversations') body = { items: state === 'declined' ? [] : [{ id: 5, peer, lastMessage: msg, unread: 1, updatedAt: Date.now(), requestState: state, isIncomingRequest: state === 'pending' }] };
      else if (name === 'load_conversation') body = { id: 5, closed: false, peer, canSend: true, blockReason: null, requestState: state, isIncomingRequest: state === 'pending', requestMessages: 1, requestLimit: 2 };
      else if (name === 'get_messages') body = { items: args.p_after_id ? [] : [msg], hasMore: false, lastReadMine: null };
      else if (name === 'sync_whispers') body = [msg];
      else if (name === 'mark_messages_delivered') body = { upTo: 0, count: 0 };
      else if (name === 'peer_presence') body = { peerId: 2, online: null, activity: null, receipts: false, announce: false, closed: false };
      else if (name === 'v3_accept_whisper') { calls.push(name); state = 'accepted'; body = true; }
      else if (name === 'v3_decline_whisper') { calls.push(name); state = 'declined'; body = true; }
      else return route.fallback();
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    });
    await page.goto('/');
    await page.getByText('Whispers', { exact: true }).last().click({ timeout: 30000 });
    await expect(page.getByRole('button', { name: /Ada.*Hello request/ })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Requests', exact: true }).click();
    await page.getByRole('button', { name: /Ada.*Hello request/ }).click();
    await expect(page.getByText('Whisper request', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: decision === 'accept' ? 'Accept Whisper' : 'Decline Whisper' }).click();
    await expect.poll(() => calls).toEqual([`v3_${decision}_whisper`]);
    if (decision === 'accept') await expect(page.getByText('Whisper request', { exact: true })).toHaveCount(0);
    else await expect(page.getByText('No Whisper requests.')).toBeVisible();
  });
}

test('Whisper privacy toggle persists the open-receiving setting through the server', async ({ page }) => {
  await offline(page, []);
  let opened = false;
  const changes: boolean[] = [];
  await page.route(`${API}/rest/v1/privacy*`, route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ profile_visibility: 'everyone', discoverable: true, show_city: true, v3_whisper_open: opened }) }));
  await page.route(`${API}/rest/v1/rpc/v3_set_whisper_open`, route => {
    opened = (route.request().postDataJSON() as { p_open: boolean }).p_open;
    changes.push(opened);
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(opened) });
  });
  await page.goto('/');
  await page.getByText('Space', { exact: true }).last().click({ timeout: 30000 });
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByText('Privacy & visibility', { exact: true }).first().click();
  const toggle = page.getByLabel('Receive Whispers without accepting');
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect.poll(() => changes).toEqual([true]);
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect.poll(() => changes).toEqual([true, false]);
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
});

test('replying to a Whisper request updates the conversation to accepted', async ({ page }) => {
  await offline(page, []);
  const peer = { id: 2, name: 'Ada', verified: false, photo: null, online: false };
  const msg = { id: 301, conversationId: 5, senderId: 2, mine: false, kind: 'text', body: 'Hello request', mediaUrl: null, meta: {}, createdAt: Date.now(), readAt: null, reactions: [] };
  let accepted = false; let sent = '';
  await page.route(`${API}/rest/v1/rpc/*`, async route => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    const args = route.request().postDataJSON() as Record<string, any>;
    let body: unknown;
    if (name === 'list_conversations') body = { items: [{ id: 5, peer, lastMessage: msg, unread: 1, updatedAt: Date.now(), requestState: accepted ? 'accepted' : 'pending', isIncomingRequest: !accepted }] };
    else if (name === 'load_conversation') body = { id: 5, closed: false, peer, canSend: true, blockReason: null, requestState: accepted ? 'accepted' : 'pending', isIncomingRequest: !accepted, requestMessages: 1, requestLimit: 2 };
    else if (name === 'get_messages') body = { items: args.p_after_id ? [] : [msg], hasMore: false, lastReadMine: null };
    else if (name === 'sync_whispers') body = [msg];
    else if (name === 'mark_messages_delivered') body = { upTo: 0, count: 0 };
    else if (name === 'peer_presence') body = { peerId: 2, online: null, activity: null, receipts: false, announce: false, closed: false };
    else if (name === 'send_message') { accepted = true; sent = args.p_body; body = { ...msg, id: 302, senderId: 1, mine: true, body: sent }; }
    else return route.fallback();
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  });
  await page.goto('/');
  await page.getByText('Whispers', { exact: true }).last().click({ timeout: 30000 });
  await page.getByRole('tab', { name: 'Requests', exact: true }).click();
  await page.getByRole('button', { name: /Ada.*Hello request/ }).click();
  await expect(page.getByText('Whisper request', { exact: true })).toBeVisible();
  await page.getByLabel('Whisper', { exact: true }).fill('Reply accepts');
  await page.getByRole('button', { name: 'Send Whisper' }).click();
  await expect.poll(() => sent).toBe('Reply accepts');
  await expect(page.getByText('Whisper request', { exact: true })).toHaveCount(0);
});
