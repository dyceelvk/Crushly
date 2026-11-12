/** Offline browser checks: mock APIs; no real accounts or uploads. */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const API = 'https://verification-test.supabase.co';
// A fixed 32-hex token, so the share assertions are deterministic offline.
const SHARE_TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const MEDIA = 'https://crushly-media.dyceelvk.workers.dev';
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64');
const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'offline@example.com' };
const profile = { id: 1, email: user.email, name: 'Offline test', username: 'offline', bio: 'My site https://example.com/about', onboarded: true, status: 'active', birthdate: '1995-01-01', verification: 'none', created_at: Date.now(), intentions: [], interests: [], languages: [], lifestyle: {} };
const person = { id: 2, name: 'Ada', username: 'ada', verified: false, photos: [], city: 'Lagos' };
const onePost = { id: 11, body: 'hello #holiday', mediaUrl: 'https://example.test/p.jpg', mediaKind: 'photo', audience: 'everyone', createdAt: Date.now(), author: person };
async function offline(page: Page, calls: Record<string, unknown>[], commentCalls: Record<string, unknown>[] = [], isAdmin = false, ranked = false, viewCalls: number[] = [], video = false, feedVideo = false, ownMoment = false, denyLists = false, railClips = false, room = false, notificationFixtures: unknown[] = [], markedCopy = false) {
  let banner: string | null = null;
  let followed = false;
  let homiePending = false;
  let outgoingVisibility = 'private'; let approvalRequired = false;
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
    else if (path === '/rest/v1/rpc/holup_space_share_token') body = SHARE_TOKEN;
    else if (path === '/rest/v1/rpc/search_holup') {
      const params = route.request().postDataJSON() as Record<string, unknown>; calls.push(params);
      body = { members: params.p_category === 'top' || params.p_category === 'people' ? [person] : [], posts: ['top', 'photos'].includes(String(params.p_category)) ? [onePost] : [], moments: [], sounds: params.p_category === 'sounds' ? [{ id: 20, title: 'Holiday tune' }] : [], places: params.p_category === 'places' ? [{ name: 'Lagos' }] : [], hashtags: params.p_category === 'hashtags' ? [{ tag: 'holiday' }] : [] };
    }
    else if (path === '/rest/v1/rpc/trending_clips' && railClips) body = Array.from({length: 6}, (_, i) => ({ ...onePost, id: 300 + i, body: `Rail clip ${i}`, mediaKind: 'video', likeCount: i + 1 }));
    else if (path === '/rest/v1/rpc/list_notifications') body = notificationFixtures;
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
    // The share sheet asks whether a marked copy exists when it opens.
    else if (path === '/rest/v1/rpc/post_download') body = markedCopy ? { path: 'posts/11/marked.mp4', bytes: 1000 } : null;
    else if (path === '/rest/v1/rpc/load_post') { const id = Number((route.request().postDataJSON() as {p_post_id: number}).p_post_id); body = { ...onePost, id, body: ranked ? `Pager item ${id}` : onePost.body, mediaUrl: video ? `${MEDIA}/m/posts/${id}.webm` : null, mediaKind: video ? 'video' : null, downloadUrl: markedCopy && video ? `${MEDIA}/m/posts/${id}-marked.mp4` : null, edit: null, circleId: null, mine: id === 12, likeCount: 0, liked: false, commentCount: 1, saved: false, viewCount: 2 }; }
    else if (path === '/rest/v1/rpc/edit_post') { const args = route.request().postDataJSON() as Record<string, unknown>; commentCalls.push(args); body = { ...onePost, id: 12, audience: args.p_audience, body: args.p_body, mediaUrl: null, mediaKind: null, edit: null, circleId: null, mine: true, likeCount: 0, liked: false, commentCount: 1, viewCount: 2 }; }
    else if (path === '/rest/v1/rpc/post_comment_settings') body = true;
    else if (path === '/rest/v1/rpc/post_likers') body = { items: [] };
    else if (path === '/rest/v1/rpc/post_comments_feed') body = { items: [{ id: 45, body: 'Hello there', createdAt: Date.now(), mine: false, author: person, parentId: null, liked: false, likeCount: 0 }, { id: 47, body: 'See https://example.com/comment.', createdAt: Date.now(), mine: false, author: person, parentId: null, liked: false, likeCount: 0 }] };
    else if (path === '/rest/v1/rpc/comment_on_post') { commentCalls.push(route.request().postDataJSON() as Record<string, unknown>); body = { id: 46 }; }
    else if (path === '/rest/v1/rpc/badges') body = { notifications: 0, whispers: 0, crushes: 0, moments: 0 };
    else if (path === '/rest/v1/rpc/crush_posts_feed') body = { items: [{ ...onePost, mediaUrl: feedVideo ? `${MEDIA}/m/posts/11.webm` : null, mediaKind: feedVideo ? 'video' : null, downloadUrl: markedCopy && feedVideo ? `${MEDIA}/m/posts/11-marked.mp4` : null, edit: null, circleId: null, mine: false, likeCount: 0, liked: false, commentCount: 1, saved: false }], nextCursor: null };
    else if (path === '/rest/v1/rpc/visible_moments') body = ownMoment ? [0, 1, 2].map(i => ({ id: 77+i, userId: 1, kind: i === 0 ? 'video' : i === 1 ? 'text' : 'photo', body: i === 0 ? 'First Moment' : i === 1 ? 'Second Moment' : 'Third Moment', mediaUrl: i === 0 ? `${MEDIA}/m/posts/11.webm` : i === 2 ? `${MEDIA}/m/posts/12.jpg` : null, edit: null, durationMs: 30000, style: 'noir', audience: 'everyone', createdAt: Date.now(), expiresAt: Date.now()+86400000, seen: false, myReaction: null, viewCount: 1, reactions: [{kind:'crush', userId:2, name:'Ada'}], author: {id:1, name: 'Offline test', verified: false, photo: null, mutual:false} })) : [];
    else if (path === '/rest/v1/rpc/moment_viewers') body = { count: 1, items: [{profile: person, viewedAt: Date.now()}] };
    else if (path === '/rest/v1/rpc/public_flow_feed') body = { items: [onePost] };
    else if (path === '/rest/v1/rpc/space_posts') body = { items: [], nextCursor: null };
    else if (path === '/rest/v1/rpc/load_profile') body = person;
    else if (path === '/rest/v1/rpc/holup_homie_stats') body = {count:2, canView:!denyLists};
    else if (path === '/rest/v1/rpc/holup_homie_status') body = {homies:false,incomingPending:false,outgoingPending:homiePending};
    else if (path === '/rest/v1/rpc/holup_request_homie') { homiePending=true; calls.push({homie:'request'}); body={status:'pending',changed:true}; }
    else if (path === '/rest/v1/rpc/holup_withdraw_homie') { homiePending=false; calls.push({homie:'withdraw'}); body=true; }
    else if (path === '/rest/v1/rpc/holup_homie_requests_inbox') body = {items:[person],hasMore:false};
    else if (path === '/rest/v1/rpc/holup_respond_homie') { calls.push({homie:'respond',...route.request().postDataJSON()}); body={status:'accepted'}; }
    else if (path === '/rest/v1/rpc/holup_homie_people') { calls.push({p_kind:'keptClose'}); body={items:[person],hasMore:false}; }
    else if (path === '/rest/v1/rpc/holup_follow_stats') body = {addUps: 3, addedUp: 4, keptClose: 2, postLikes: 7, canViewAddUps: !denyLists, canViewAddedUp: !denyLists, canViewKeptClose: !denyLists, addUpVisibility: 'private', outgoingVisibility, approvalRequired, myStatus: followed ? 'active' : null};
    else if (path === '/rest/v1/rpc/holup_follow_status') body = {status: followed ? 'active' : null};
    else if (path === '/rest/v1/rpc/holup_follow') { followed = true; calls.push({followed: true}); body = {status:'active',changed:true}; }
    else if (path === '/rest/v1/rpc/holup_unfollow') { followed = false; body = true; }
    else if (path === '/rest/v1/rpc/holup_set_follow_settings') { const args = route.request().postDataJSON(); calls.push(args); if (args.p_outgoing_visibility != null) outgoingVisibility=args.p_outgoing_visibility; if (args.p_approval != null) approvalRequired=args.p_approval; body=true; }
    else if (path === '/rest/v1/rpc/holup_pending_follow_requests') body = {items:[],hasMore:false};
    else if (path === '/rest/v1/rpc/holup_follow_people' || path === '/rest/v1/rpc/space_relationship_people') { calls.push(route.request().postDataJSON() as Record<string, unknown>); body = {items: [person], hasMore: false}; }
    else if (path === '/rest/v1/rpc/flow_feed' || path === '/rest/v1/rpc/flow_ranked_feed') body = { items: ranked ? [11, 12, 13].map((id) => ({ ...onePost, id, body: `Pager item ${id}`, mediaUrl: video ? `${MEDIA}/m/posts/${id}.webm` : null, mediaKind: video ? 'video' : null, downloadUrl: markedCopy && video ? `${MEDIA}/m/posts/${id}-marked.mp4` : null, mine: id === 12, likeCount: 0, liked: false, commentCount: 0, viewCount: 2 })) : [], nextCursor: null };
    else if (path === '/rest/v1/rpc/my_circles') body = { items: room ? [{id: 5, name: 'Offline room', about: 'Test', myRole:'owner', ownerId:1, memberCount:1, createdAt:Date.now(), muted:false, coverUrl:null, unreadCount:0, lastMessageAt:null}] : [] };
    else if (path === '/rest/v1/rpc/circle_space' && room) body = { circle: {id:5, name:'Offline room', about:'Test', myRole:'owner', ownerId:1, memberCount:1, createdAt:Date.now(), muted:false, coverUrl:null}, members: [{ member: {...person, id:1}, role:'owner', joinedAt:Date.now() }] };
    else if ((path === '/rest/v1/rpc/circle_feed' || path === '/rest/v1/rpc/circle_messages') && room) body = {items:[]};
    else if (path === '/rest/v1/rpc/heartbeat') body = true;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': '*' } });
  });
}
test('search categories, filters and result routes work on a phone-sized web screen', async ({ page }) => {
  const calls: Record<string, unknown>[] = []; await offline(page, calls); await page.goto('/');
  await page.getByRole('button', { name: 'Search holUpp' }).first().click({ timeout: 30000 });
  await page.getByPlaceholder('Search holUpp').fill('holiday');
  for (const label of ['Top', 'Clips', 'Photos', 'People', 'Sounds', 'Places', 'Hashtags', 'Moments']) {
    const tab = page.getByRole('tab', { name: label, exact: true }); await expect(tab).toBeVisible(); await tab.click();
    await expect.poll(() => calls.at(-1)?.p_category).toBe(label.toLowerCase());
  }
  await page.getByRole('tab', { name: 'Places', exact: true }).click();
  await page.getByRole('button', { name: 'People in Lagos' }).click();
  await expect.poll(() => calls.at(-1)?.p_place).toBe('Lagos');
  await page.getByPlaceholder('Search holUpp').fill('holiday');
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
  await page.getByRole('button', { name: 'Search holUpp' }).first().click({ timeout: 30000 });
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
  await page.getByRole('button', { name: 'Search holUpp' }).first().click({ timeout: 30000 });
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
  await page.getByText('holUpp admin', { exact: true }).click();
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
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('https://holupp.net/v/11');
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
  await expect(page.getByText('holUpp admin', { exact: true })).toHaveCount(0);
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


test('Space bio link opens inside holUpp and own Space link copies from three dots', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await offline(page, []); await page.goto('/');
  await page.getByText('Space', { exact: true }).last().click({ timeout: 30000 });
  const bioLink = page.getByRole('link', { name: /Open link to example.com\/about inside holUpp/ }).first();
  await expect(bioLink).toBeVisible({ timeout: 30000 });
  await bioLink.click();
  await expect(page.getByText('Inside holUpp', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close preview' }).click();
  await page.getByRole('button', { name: 'More Space options' }).click();
  await page.getByRole('button', { name: 'Copy Space link' }).click();
  await expect(page.getByText('Link copied')).toBeVisible();
  // A Space link carries a minted token, never the member's sequential id.
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`https://holupp.net/s/${SHARE_TOKEN}`);
});

test('comment link closes sheet and opens inside holUpp without punctuation', async ({ page }) => {
  await offline(page, []); await page.goto('/');
  await page.getByText('Crushes', { exact: true }).first().click({ timeout: 30000 });
  await page.getByRole('button', { name: /Comments, 1 comment/ }).first().click();
  await page.getByRole('link', { name: 'Open link to example.com/comment inside holUpp' }).click();
  await expect(page.getByText('Inside holUpp', { exact: true })).toBeVisible();
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


test('Space has working app navigation and real stats', async ({ page }) => {
  await offline(page, []); await page.goto('/');
  await page.getByText('Space', { exact: true }).last().click({timeout:30000});
  await expect(page.getByText('Post likes', {exact:false})).toBeVisible();
  for (const label of ['Home', 'Connections', 'Create post', 'Whispers', 'Notifications']) {
    await expect(page.getByRole('button', {name: label, exact:true})).toBeVisible();
  }
  await page.getByRole('button', {name:'Connections', exact:true}).click();
  await expect(page.getByRole('tab', {name:'Connections', exact:true}).first()).toBeVisible();
});

test('owner can open the approved Homies list', async ({ page }) => {
  const calls: Record<string, unknown>[] = []; await offline(page, calls); await page.goto('/');
  await page.getByText('Space', { exact: true }).last().click({timeout:30000});
  await page.getByRole('button', { name: '2 Homies. View people' }).click();
  await expect(page.getByRole('button', { name: 'Open Ada’s Space' })).toBeVisible();
  expect(calls.some(x => x.p_kind === 'keptClose')).toBe(true);
});

test('Connections is one bottom button, not a swipe destination in Home', async ({ page }) => {
  await offline(page, []); await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Crushes', exact: true })).toBeVisible({timeout:30000});
  await page.getByRole('tab', { name: 'Connections', exact: true }).last().click();
  await expect(page.getByRole('tab', { name: 'Connections', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Discovery', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Home', exact: true }).last().click();
  await expect(page.getByRole('tab', { name: 'Discovery', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Connections', exact: true })).toHaveCount(1);
});

test('Crushes clip has a sound button, sharing, and picture opens Flow', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await offline(page, [], [], false, false, [], true, true); await page.goto('/');
  const clip = page.getByRole('button', { name: 'Open Ada’s clip in Flow' });
  const sound = page.getByRole('button', {name:'Unmute Ada’s clip'});
  await expect(clip).toBeVisible({timeout:30000});
  await expect(sound).toBeVisible();
  await expect.poll(async () => page.locator('video').evaluateAll(vs => vs.some(v => !v.paused && v.currentTime > 0.1)), {timeout:20000}).toBe(true);
  await sound.click();
  await expect(page.getByRole('button', {name:'Mute Ada’s clip'})).toBeVisible();
  await expect.poll(async () => page.locator('video').evaluateAll(vs => vs.some(v => !v.paused && !v.muted))).toBe(true);
  await page.getByRole('button', {name:'Mute Ada’s clip'}).click();
  await expect(sound).toBeVisible();
  await expect.poll(async () => page.locator('video').evaluateAll(vs => vs.some(v => !v.paused && v.muted))).toBe(true);
  await expect(page.getByRole('button', {name:'Open Ada’s Flow'})).toHaveCount(0);
  const like = page.getByRole('button', {name:'Crush this post'}).first();
  const comment = page.getByRole('button', {name:'Comments'}).first();
  const share = page.getByRole('button', {name:'Share this post'}).first();
  const l=await like.boundingBox(), c=await comment.boundingBox(), sh=await share.boundingBox(), vol=await sound.boundingBox(), pic=await page.locator('video').first().boundingBox();
  expect(l && c && sh && vol && pic).toBeTruthy();
  expect(l!.x).toBeLessThan(c!.x); expect(c!.x).toBeLessThan(sh!.x);
  expect(vol!.x + vol!.width).toBeCloseTo(pic!.x + pic!.width - 10, 0);
  await share.click(); await expect(page.getByText('Send this post')).toBeVisible();
  await page.getByRole('button', {name:'Copy post link'}).click();
  await expect(page.getByText('Link copied')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('https://holupp.net/v/11');
  await page.getByRole('button', {name:'Close', exact:true}).last().click();
  await expect(page.getByText('Send this post')).not.toBeVisible();
  await clip.click({position:{x:100,y:100}});
  await expect(page.getByText('THE FLOW')).toBeVisible();
  const flow = page.getByRole('button', {name:'Video by Ada'});
  await expect(flow).toBeVisible();
  await expect.poll(async () => page.locator('video').evaluateAll(vs => vs.some(v => !v.paused && getComputedStyle(v).objectFit === 'contain')), {timeout:20000}).toBe(true);
  await flow.click({position:{x:100,y:100}});
  await expect.poll(async () => page.locator('video').evaluateAll(vs => vs.filter(v => getComputedStyle(v).objectFit === 'contain').every(v => v.paused))).toBe(true);
});

test('Crushes controls remain tappable on a narrow phone', async ({ page }) => {
  await page.setViewportSize({width:320,height:720});
  await offline(page, [], [], false, false, [], true, true); await page.goto('/');
  const mute=page.getByRole('button', {name:'Unmute Ada’s clip'});
  const share=page.getByRole('button', {name:'Share this post'}).first();
  await expect(mute).toBeVisible({timeout:30000});
  const mb=await mute.boundingBox(), sb=await share.boundingBox();
  expect(mb && sb).toBeTruthy();
  expect(sb!.x + sb!.width).toBeLessThan(mb!.x);
  await mute.click(); await expect(page.getByRole('button',{name:'Mute Ada’s clip'})).toBeVisible();
  await share.click(); await expect(page.getByText('Send this post')).toBeVisible();
});

test('Space relationship list is a full screen with a back button and real suggestions', async ({ page }) => {
  await offline(page, []); await page.goto('/');
  await page.getByText('Space', {exact:true}).last().click({timeout:30000});
  await page.getByRole('button', {name:'3 Add Ups. View people'}).click();
  await expect(page.getByRole('button', {name:'Back to Space'})).toBeVisible();
  await expect(page.getByText('Discover', {exact:true}).last()).toBeVisible();
  await expect(page.getByRole('button', {name:'Discover Ada’s Space'})).toBeVisible();
  await page.getByRole('button', {name:'Back to Space'}).click();
  await expect(page.getByRole('button', {name:'3 Add Ups. View people'})).toBeVisible();
});

test('Moment hold preserves video, swipe up opens activity and down closes', async ({ page }) => {
  await offline(page, [], [], false, false, [], false, false, true); await page.goto('/');
  await page.getByText('Space', {exact:true}).last().click({timeout:30000});
  await page.getByRole('tab', {name:'Moments', exact:true}).click();
  await page.getByRole('button', {name:/Play Offline test’s Moment/}).first().click();
  const player = page.getByRole('button', {name:'Moments player'});
  await expect(player).toBeVisible();
  await expect.poll(async () => page.locator('video').evaluateAll(vs => vs.some(v => !v.paused && v.currentTime > 0.2)), {timeout:20000}).toBe(true);
  await page.mouse.move(300, 350); await page.mouse.down(); await page.waitForTimeout(600);
  await expect.poll(async () => page.locator('video').evaluateAll(vs => vs.some(v => v.paused && v.currentTime > 0.1))).toBe(true);
  const t = await page.locator('video').first().evaluate((v: HTMLVideoElement) => v.currentTime);
  await page.mouse.up();
  await expect.poll(async () => page.locator('video').evaluateAll((vs, time) => vs.some(v => !v.paused && v.currentTime > time), t)).toBe(true);
  await player.click({position: {x: 300, y: 300}});
  await expect(page.getByText('Second Moment').last()).toBeVisible();
  await page.mouse.move(250, 500); await page.mouse.down(); await page.mouse.move(250, 300, {steps:8}); await page.mouse.up();
  await expect(page.getByText('Moment activity')).toBeVisible();
  await expect(page.getByRole('dialog').getByText('♥ Ada')).toBeVisible();
  await page.waitForTimeout(500);
  const grabber = page.getByLabel('Swipe down to close');
  const box = await grabber.boundingBox(); if (!box) throw new Error('Moment activity grabber missing');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 90, {steps:8}); await page.mouse.up();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.waitForTimeout(500);
  await page.mouse.move(250, 300); await page.mouse.down(); await page.mouse.move(250, 500, {steps:8}); await page.mouse.up();
  await expect(player).not.toBeVisible();
});

test('a private relationship list shows the access notice without requesting identities', async ({ page }) => {
  const calls: Record<string, unknown>[] = [];
  await offline(page, calls, [], false, false, [], false, false, false, true); await page.goto('/');
  await page.getByText('Space', {exact:true}).last().click({timeout:30000});
  await page.getByRole('button', {name:'3 Add Ups. View people'}).click();
  await expect(page.getByText('Offline test has limited who can view their Add Ups.')).toBeVisible();
  expect(calls.some(x => x.p_kind === 'addUps')).toBe(false);
  await expect(page.getByRole('button', {name:'Back to Space'})).toBeVisible();
});

test('Added Up opens a real list and its visibility setting is saved', async ({page}) => {
  const calls: Record<string, unknown>[] = []; await offline(page,calls); await page.goto('/');
  await page.getByText('Space',{exact:true}).last().click({timeout:30000});
  await page.getByRole('button',{name:'4 Added Up. View people'}).click();
  await expect(page.getByRole('button',{name:'Open Ada’s Space'})).toBeVisible();
  expect(calls.some(x=>x.p_kind === 'addedUp')).toBe(true);
  await page.getByRole('button',{name:'Back to Space'}).click();
  await page.getByRole('button',{name:'Added Up list privacy'}).click();
  await page.getByText('Homies',{exact:true}).last().click();
  await expect.poll(()=>calls.some(x=>x.p_outgoing_visibility === 'close')).toBe(true);
});

test('Discover suggestion Add Up calls the real follow action and reflects its result', async ({page}) => {
  const calls: Record<string, unknown>[] = []; await offline(page,calls); await page.goto('/');
  await page.getByText('Space',{exact:true}).last().click({timeout:30000});
  await page.getByRole('button',{name:'3 Add Ups. View people'}).click();
  await page.getByRole('button',{name:'Add Up Ada'}).click();
  await expect.poll(()=>calls.some(x=>x.followed === true)).toBe(true);
  await expect(page.getByRole('button',{name:'Added Up Ada'})).toBeVisible();
});


test('holding a text or photo Moment freezes its progress until released', async ({page}) => {
  test.setTimeout(35000);
  await offline(page, [], [], false, false, [], false, false, true); await page.goto('/');
  await page.getByText('Space', {exact:true}).last().click({timeout:30000});
  await page.getByRole('tab', {name:'Moments', exact:true}).click();
  await page.getByRole('button', {name:/Play Offline test’s Moment/}).first().click();
  const player=page.getByRole('button',{name:'Moments player'});
  await player.click({position:{x:300,y:300}});
  await expect(page.getByText('Second Moment').last()).toBeVisible();
  await page.mouse.move(300,350); await page.mouse.down(); await page.waitForTimeout(6500);
  await expect(page.getByText('Second Moment').last()).toBeVisible();
  await page.mouse.up();
  await player.click({position:{x:300,y:300}});
  await expect(page.getByText('Third Moment').last()).toBeVisible();
  await page.mouse.move(300,350); await page.mouse.down(); await page.waitForTimeout(6500);
  await expect(page.getByText('Third Moment').last()).toBeVisible();
  await page.mouse.up();
  await expect(page.getByText('Third Moment').last()).toBeVisible();
});

/** Real touch events, not click/keyboard stand-ins for a swipe. */
async function dragTouch(page: Page, fromX: number, fromY: number, toX: number, toY: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 1});
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: fromX, y: fromY}]});
  for (let i = 1; i <= 12; i++) {
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: fromX + (toX-fromX)*i/12, y: fromY + (toY-fromY)*i/12}]});
    await page.waitForTimeout(15);
  }
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await cdp.detach();
  await page.waitForTimeout(400);
}

test('touch swipes move Home and Whispers pages; taps and bottom navigation still work', async ({page}) => {
  await offline(page, []); await page.goto('/');
  await expect(page.getByRole('tab', {name:'Crushes', exact:true})).toBeVisible({timeout:30000});
  await expect(page.getByRole('button', {name:/Comments, 1 comment/}).first()).toBeVisible();
  await dragTouch(page, 300, 430, 70, 430);
  await expect(page.getByText('From everyone', {exact:true})).toBeVisible();
  await dragTouch(page, 70, 430, 300, 430);
  await expect(page.getByRole('button', {name:/Comments, 1 comment/}).first()).toBeVisible();
  await page.getByRole('tab', {name:'Whispers', exact:true}).click();
  await expect(page.getByRole('tab', {name:'Whispers', exact:true}).first()).toBeVisible();
  await dragTouch(page, 300, 430, 70, 430);
  await expect(page.getByText('Homies are accepted friendships.', {exact:false})).toBeVisible();
  await dragTouch(page, 70, 430, 300, 430);
  await expect(page.getByPlaceholder('Search your Whispers')).toBeVisible();
  await page.getByRole('tab', {name:'Homies', exact:true}).click();
  await expect(page.getByText('Homies are accepted friendships.', {exact:false})).toBeVisible();
  await page.getByRole('tab', {name:'Connections', exact:true}).click();
  await dragTouch(page, 310, 805, 75, 805);
  await expect(page.getByRole('tab', {name:'Homies', exact:true})).toBeVisible();
  await expect(page.getByRole('button', {name:'Create post', exact:true})).toBeVisible();
});

test('touch swipes switch notification and comment tabs without closing the sheet', async ({page}) => {
  await offline(page, []); await page.goto('/');
  await page.getByRole('button', {name:'Notifications', exact:true}).first().click({timeout:30000});
  await expect(page.getByRole('tab', {name:'Yours', exact:true})).toBeVisible();
  const yours = await page.getByRole('tab', {name:'Yours', exact:true}).boundingBox();
  if (!yours) throw Error('Notification tabs missing');
  await dragTouch(page, 230, yours.y + 10, 40, yours.y + 10);
  await expect(page.getByText('No other updates from holUpp')).toBeVisible();
  await dragTouch(page, 70, 430, 300, 430);
  await expect(page.getByText('All quiet for now')).toBeVisible();
  await page.getByRole('button', {name:'Go back'}).click();
  await page.getByRole('button', {name:/Comments, 1 comment/}).first().click();
  await expect(page.getByText('Hello there')).toBeVisible();
  await page.waitForTimeout(700); // let the sheet finish its entrance transition
  await dragTouch(page, 300, 530, 70, 530);
  await expect(page.getByText('No reactions on this post yet.')).toBeVisible();
  await dragTouch(page, 70, 530, 300, 530);
  await expect(page.getByText('Hello there')).toBeVisible();
  await page.getByRole('button', {name:'Close', exact:true}).last().click();
});

test('search and Space navigation tabs support touch swipes without changing settings', async ({page}) => {
  const calls: Record<string, unknown>[] = []; await offline(page, calls); await page.goto('/');
  await page.getByRole('button', {name:'Search holUpp'}).first().click({timeout:30000});
  await page.getByPlaceholder('Search holUpp').fill('holiday');
  await expect(page.getByRole('tab', {name:'Top', exact:true})).toBeVisible();
  await dragTouch(page, 300, 430, 70, 430);
  await expect.poll(() => calls.at(-1)?.p_category).toBe('clips');
  await page.getByRole('button', {name:'Back', exact:true}).click();
  await page.getByText('Space', {exact:true}).last().click();
  await expect(page.getByRole('tab', {name:'Crushes', exact:true})).toBeVisible();
  const tab = await page.getByRole('tab', {name:'Crushes', exact:true}).boundingBox();
  if (!tab) throw Error('Space tab missing');
  await dragTouch(page, 300, tab.y + 20, 70, tab.y + 20);
  await expect(page.getByText('No Moments right now')).toBeVisible();
  await page.getByRole('tab', {name:'About', exact:true}).click();
  await expect(page.getByText('My site', {exact:false}).first()).toBeVisible();
});


test('a horizontal clip rail keeps its own touch scroll instead of switching Home tabs', async ({page}) => {
  await offline(page, [], [], false, false, [], false, false, false, false, true); await page.goto('/');
  await page.getByRole('tab', {name:'Discovery', exact:true}).click({timeout:30000});
  const clip = page.getByRole('button', {name:/Rail clip 0/});
  await expect(clip).toBeVisible();
  const rail = clip.locator('xpath=../..');
  const box = await clip.boundingBox();
  if (!box) throw Error('Clip rail not visible');
  const before = await rail.evaluate(e => e.scrollLeft);
  await dragTouch(page, Math.min(340, box.x + box.width), box.y + 60, 45, box.y + 60);
  await expect.poll(() => rail.evaluate(e => e.scrollLeft)).toBeGreaterThan(before);
  await expect(page.getByText('Top Crushes This Week')).toBeVisible();
});


test('Circle chat draft survives swiping to posts and back', async ({page}) => {
  await offline(page, [], [], false, false, [], false, false, false, false, false, true); await page.goto('/');
  await page.getByText('Space', {exact:true}).last().click({timeout:30000});
  await page.getByRole('tab', {name:'Circles', exact:true}).click();
  await page.getByText('Offline room', {exact:true}).first().click();
  const composer = page.getByPlaceholder('Write something…');
  await expect(composer).toBeVisible();
  await composer.fill('Unsent room draft');
  await dragTouch(page, 300, 330, 60, 330);
  await expect(composer).toHaveCount(0);
  await dragTouch(page, 60, 330, 300, 330);
  await expect(composer).toHaveValue('Unsent room draft');
});


test('notification categories swipe independently while the category rail still scrolls', async ({page}) => {
  const n = (id: number, kind: string, name: string) => ({id, kind, actor:{...person, id: id + 2, name}, body:'', refId: 11, read: true, createdAt:Date.now()});
  await offline(page, [], [], false, false, [], false, false, false, false, false, false, [n(1,'message','Whisperer'), n(2,'post_comment','Commenter'), n(3,'crush','Adder'), n(4,'keep','Homie'), n(5,'moment_reaction','Momenter'), n(6,'circle_joined','Circler')]);
  await page.goto('/');
  await page.getByRole('button', {name:'Notifications', exact:true}).first().click({timeout:30000});
  await expect(page.getByText('Whisperer sent you a Whisper.')).toBeVisible();
  await expect(page.getByText('Commenter commented on your post.')).toBeVisible();
  await dragTouch(page, 300, 430, 70, 430);
  await expect(page.getByText('Whisperer sent you a Whisper.')).toBeVisible();
  await expect(page.getByText('Commenter commented on your post.')).toHaveCount(0);
  await dragTouch(page, 300, 430, 70, 430);
  await expect(page.getByText('Commenter commented on your post.')).toBeVisible();
  await expect(page.getByText('Whisperer sent you a Whisper.')).toHaveCount(0);
  await dragTouch(page, 70, 430, 300, 430);
  await expect(page.getByText('Whisperer sent you a Whisper.')).toBeVisible();
  // A drag on the horizontal chip rail scrolls the rail, not the notification list.
  const chip = page.getByRole('tab', {name:'Whispers', exact:true});
  const rail = chip.locator('xpath=../..');
  const box = await chip.boundingBox();
  if (!box) throw Error('Category rail missing');
  const left = await rail.evaluate(e => e.scrollLeft);
  await dragTouch(page, 300, box.y + box.height / 2, 55, box.y + box.height / 2);
  await expect.poll(() => rail.evaluate(e => e.scrollLeft)).toBeGreaterThan(left);
  await expect(page.getByText('Whisperer sent you a Whisper.')).toBeVisible();
});

test('Space navigation swipe goes to Whispers without opening Create', async ({page}) => {
  await offline(page, []); await page.goto('/');
  await page.getByText('Space', {exact:true}).last().click({timeout:30000});
  await expect(page.getByRole('button', {name:'Whispers', exact:true})).toBeVisible();
  const nav = await page.getByRole('button', {name:'Whispers', exact:true}).boundingBox();
  if (!nav) throw Error('Space navigation missing');
  await dragTouch(page, 65, nav.y + nav.height / 2, 310, nav.y + nav.height / 2);
  await expect(page.getByPlaceholder('Search your Whispers')).toBeVisible();
  await expect(page.getByRole('button', {name:'Create post', exact:true})).toBeVisible();
});

test('scrolling and swiping on a privacy selector never changes the setting', async ({page}) => {
  const privacyWrites: string[] = [];
  page.on('request', req => { if (req.method() === 'PATCH' && new URL(req.url()).pathname === '/rest/v1/privacy') privacyWrites.push(req.postData() || ''); });
  await offline(page, []); await page.goto('/');
  await page.getByText('Space', {exact:true}).last().click({timeout:30000});
  await page.getByRole('button', {name:'Settings'}).click();
  await page.getByText('Privacy & visibility', {exact:true}).first().click();
  await expect(page.getByText('Show me in Discover', {exact:true})).toBeVisible();
  await dragTouch(page, 320, 700, 320, 260);
  const title = page.getByText('Who can see my full Space', {exact:true});
  await expect(title).toBeVisible();
  const row = title.locator('xpath=..').getByRole('tab', {name:'Everyone', exact:true});
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();
  if (!box) throw Error('Privacy selector not visible');
  await dragTouch(page, 300, box.y + box.height / 2, 65, box.y + box.height / 2);
  await page.waitForTimeout(400);
  expect(privacyWrites).toEqual([]);
});


test('Homie requests are explicit and pending requests can be withdrawn', async ({page}) => {
 const calls: Record<string, unknown>[]=[]; await offline(page,calls); await page.goto('/');
 await page.getByText('Space',{exact:true}).last().click({timeout:30000});
 await page.getByRole('button',{name:'View Homie requests'}).click();
 await expect(page.getByText('Homie requests',{exact:true}).last()).toBeVisible();
 await page.getByRole('button',{name:'Accept',exact:true}).click();
 await expect.poll(()=>calls.some(c=>c.homie==='respond' && c.p_accept===true)).toBe(true);
 await page.getByRole('button',{name:'Back to Space'}).last().click();
 await page.getByRole('button',{name:'2 Homies. View people'}).click();
 await page.getByRole('button',{name:'Open Ada’s Space'}).click();
 const add=page.getByRole('button',{name:'Ask Ada to be Homies'});
 await expect(add).toBeVisible(); await add.click();
 const withdraw=page.getByRole('button',{name:'Homie request to Ada sent. Tap to withdraw'});
 await expect(withdraw).toBeVisible(); await withdraw.click();
 await expect(add).toBeVisible();
 expect(calls.some(c=>c.homie==='request')).toBe(true);
 expect(calls.some(c=>c.homie==='withdraw')).toBe(true);
});

test('Homies tab shows accepted people and requests without a remove button', async ({page}) => {
 const calls: Record<string, unknown>[]=[]; await offline(page,calls); await page.goto('/');
 await page.getByRole('tab',{name:'Whispers',exact:true}).click({timeout:30000});
 await page.getByRole('tab',{name:'Homies',exact:true}).click();
 await expect(page.getByText('Your Homies',{exact:true})).toBeVisible();
 await expect(page.getByText('Requests',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Let go'})).toHaveCount(0);
 await page.getByRole('button',{name:'Decline',exact:true}).click();
 await expect.poll(()=>calls.some(c=>c.homie==='respond' && c.p_accept===false)).toBe(true);
});

// Saving a clip lives in the share sheet, with Copy link and Share outside,
// because all three answer "how does this leave the app". It must appear only
// when a marked copy exists: offering it otherwise would hand out somebody's
// work with no name on it, which is the one thing this feature must never do.
test('the share sheet offers Save clip only when the clip has a marked copy', async ({ page }) => {
  // A clip with no marked copy: the row is absent, not disabled.
  await offline(page, [], [], false, false, [], true); await page.goto('/?post=11');
  await page.getByRole('button', { name: 'Share this post' }).first().click({ timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Copy post link' })).toBeVisible();
  expect(await page.getByRole('button', { name: 'Save this clip to your device' }).count()).toBe(0);
});

test('the share sheet offers Save clip for a clip that has one', async ({ page }) => {
  // video, and the harness answers with a marked copy as well as the original.
  await offline(page, [], [], false, false, [], /*video*/ true, /*feedVideo*/ true,
    /*ownMoment*/ false, /*denyLists*/ false, /*railClips*/ false, /*room*/ false,
    /*notifications*/ [], /*markedCopy*/ true);
  await page.goto('/?post=11');
  await page.getByRole('button', { name: 'Share this post' }).first().click({ timeout: 30000 });
  const save = page.getByRole('button', { name: 'Save this clip to your device' });
  await expect(save).toBeVisible();
  // The wording has to say the copy is marked, or the row is a surprise later.
  await expect(page.getByText('with the holUpp mark')).toBeVisible();
  // It sits in the same block as the other two ways out of the app.
  await expect(page.getByRole('button', { name: 'Copy post link' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Share outside holUpp' })).toBeVisible();
});
