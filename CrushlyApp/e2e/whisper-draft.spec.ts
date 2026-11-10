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
async function offline(page: Page, calls: Record<string, unknown>[], commentCalls: Record<string, unknown>[] = [], isAdmin = false, ranked = false, viewCalls: number[] = [], video = false, feedVideo = false, ownMoment = false, denyLists = false, railClips = false, room = false, notificationFixtures: unknown[] = [], legacy = false, whisper = false, requester = false) {
  let accepted = false;
  let hidden = false;
  const whisperMessage = { id: 91, conversationId: 19, senderId: 2, mine: false, kind: 'text', body: 'A private hello', mediaUrl: null, meta: {}, createdAt: Date.now(), readAt: null, reactions: [] };
  const whisperPeer = { id: 2, name: 'Ada', photo: null, online: false, verified: false };
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
    if (legacy && path === '/rest/v1/rpc/holup_follow_status') {
      calls.push({ legacyProbe: true });
      return route.fulfill({status: 404, contentType: 'application/json', headers: {'access-control-allow-origin':'*','access-control-expose-headers':'*'}, body: JSON.stringify({code:'PGRST202', message:'Could not find the function public.holup_follow_status(p_target) in the schema cache'})});
    }
    if (legacy && path === '/rest/v1/rpc/space_relationship_stats') {
      calls.push({ legacyStats: true });
      return route.fulfill({status: 200, contentType: 'application/json', headers: {'access-control-allow-origin':'*'}, body: JSON.stringify({addUps:3,keptClose:2,postLikes:7,canViewAddUps:true,canViewKeptClose:true,addUpVisibility:'private'})});
    }
    if (whisper && path === '/rest/v1/rpc/list_conversations') body = { items: hidden ? [] : [{ id: 19, peer: whisperPeer, lastMessage: whisperMessage, unread: 1, updatedAt: Date.now() }] };
    else if (whisper && path === '/rest/v1/rpc/load_conversation') body = { id: 19, peer: whisperPeer, closed: false, canSend: !requester || accepted, blockReason: requester && !accepted ? 'Wait for this Whisper request to be accepted.' : null, whisperConsent: { state: accepted ? 'accepted' : 'pending', requester, sent: requester ? 2 : 1, canAccept: !requester && !accepted } };
    else if (whisper && path === '/rest/v1/rpc/get_messages') body = { items: hidden ? [] : [whisperMessage], hasMore: false, lastReadMine: null };
    else if (whisper && path === '/rest/v1/rpc/holup_accept_whisper') { accepted = true; calls.push({ accept: true }); body = true; }
    else if (whisper && path === '/rest/v1/rpc/holup_delete_whisper') { hidden = true; calls.push({ deleted: route.request().postDataJSON() }); body = true; }
    else if (whisper && path === '/rest/v1/rpc/holup_visible_whisper_ids') body = hidden ? [] : [91];
    else if (whisper && path === '/rest/v1/rpc/peer_presence') body = { peerId: 2, online: false, activity: null, announce: false, receipts: false, closed: false };
    else if (whisper && path === '/rest/v1/rpc/mark_messages_delivered') body = { upTo: 0, count: 0 };
    else if (whisper && path === '/rest/v1/rpc/mark_conversation_read') body = true;
    else if (path === '/auth/v1/user') body = user;
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
    else if (path === '/rest/v1/rpc/load_post') { const id = Number((route.request().postDataJSON() as {p_post_id: number}).p_post_id); body = { ...onePost, id, body: ranked ? `Pager item ${id}` : onePost.body, mediaUrl: video ? `${MEDIA}/m/posts/${id}.webm` : null, mediaKind: video ? 'video' : null, edit: null, circleId: null, mine: id === 12, likeCount: 0, liked: false, commentCount: 1, saved: false, viewCount: 2 }; }
    else if (path === '/rest/v1/rpc/edit_post') { const args = route.request().postDataJSON() as Record<string, unknown>; commentCalls.push(args); body = { ...onePost, id: 12, audience: args.p_audience, body: args.p_body, mediaUrl: null, mediaKind: null, edit: null, circleId: null, mine: true, likeCount: 0, liked: false, commentCount: 1, viewCount: 2 }; }
    else if (path === '/rest/v1/rpc/post_comment_settings') body = true;
    else if (path === '/rest/v1/rpc/post_likers') body = { items: [] };
    else if (path === '/rest/v1/rpc/post_comments_feed') body = { items: [{ id: 45, body: 'Hello there', createdAt: Date.now(), mine: false, author: person, parentId: null, liked: false, likeCount: 0 }, { id: 47, body: 'See https://example.com/comment.', createdAt: Date.now(), mine: false, author: person, parentId: null, liked: false, likeCount: 0 }] };
    else if (path === '/rest/v1/rpc/comment_on_post') { commentCalls.push(route.request().postDataJSON() as Record<string, unknown>); body = { id: 46 }; }
    else if (path === '/rest/v1/rpc/badges') body = { notifications: 0, whispers: 0, crushes: 0, moments: 0 };
    else if (path === '/rest/v1/rpc/crush_posts_feed') body = { items: [{ ...onePost, mediaUrl: feedVideo ? `${MEDIA}/m/posts/11.webm` : null, mediaKind: feedVideo ? 'video' : null, edit: null, circleId: null, mine: false, likeCount: 0, liked: false, commentCount: 1, saved: false }], nextCursor: null };
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
    else if (path === '/rest/v1/rpc/flow_feed' || path === '/rest/v1/rpc/flow_ranked_feed') body = { items: ranked ? [11, 12, 13].map((id) => ({ ...onePost, id, body: `Pager item ${id}`, mediaUrl: video ? `${MEDIA}/m/posts/${id}.webm` : null, mediaKind: video ? 'video' : null, mine: id === 12, likeCount: 0, liked: false, commentCount: 0, viewCount: 2 })) : [], nextCursor: null };
    else if (path === '/rest/v1/rpc/my_circles') body = { items: room ? [{id: 5, name: 'Offline room', about: 'Test', myRole:'owner', ownerId:1, memberCount:1, createdAt:Date.now(), muted:false, coverUrl:null, unreadCount:0, lastMessageAt:null}] : [] };
    else if (path === '/rest/v1/rpc/circle_space' && room) body = { circle: {id:5, name:'Offline room', about:'Test', myRole:'owner', ownerId:1, memberCount:1, createdAt:Date.now(), muted:false, coverUrl:null}, members: [{ member: {...person, id:1}, role:'owner', joinedAt:Date.now() }] };
    else if ((path === '/rest/v1/rpc/circle_feed' || path === '/rest/v1/rpc/circle_messages') && room) body = {items:[]};
    else if (path === '/rest/v1/rpc/heartbeat') body = true;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': '*' } });
  });
}

test('request can be accepted and a Whisper hidden in the draft UI', async ({page}) => {
 const calls: Record<string, unknown>[] = [];
 await offline(page, calls, [], false, false, [], false, false, false, false, false, false, [], false, true);
 await page.goto('/');
 await page.getByRole('tab', {name:'Whispers', exact:true}).click({timeout:30000});
 await page.getByRole('button', {name:/Ada, 1 unread/}).click();
 await expect(page.getByText('Replying accepts this Whisper, or accept it now.')).toBeVisible();
 await page.getByRole('button', {name:'Accept Whisper'}).click();
 await expect.poll(() => calls.some(x=>x.accept)).toBe(true);
 await expect(page.getByRole('button', {name:'Accept Whisper'})).toHaveCount(0);
 const bubble=page.getByRole('button', {name:/Ada: A private hello/});
 await expect(bubble).toBeVisible();
 await bubble.hover(); await page.mouse.down(); await page.waitForTimeout(500); await page.mouse.up();
 await page.getByRole('button', {name:'Delete for me'}).click();
 await expect.poll(()=>calls.some(x=>x.deleted)).toBe(true);
 await expect(page.getByRole('button',{name:/Ada: A private hello/})).toHaveCount(0);
 expect(calls.find(x=>x.deleted)?.deleted).toEqual({p_message_id:91,p_everyone:false});
});

test('a sender at the request limit sees the lock and no accept button', async ({page}) => {
 await offline(page, [], [], false, false, [], false, false, false, false, false, false, [], false, true, true);
 await page.goto('/');
 await page.getByRole('tab', {name:'Whispers', exact:true}).click({timeout:30000});
 await page.getByRole('button', {name:/Ada, 1 unread/}).click();
 await expect(page.getByText('You can send two Whispers before they accept. 0 left.')).toBeVisible();
 await expect(page.getByText('Wait for this Whisper request to be accepted.')).toBeVisible();
 await expect(page.getByRole('button', {name:'Accept Whisper'})).toHaveCount(0);
 await expect(page.getByLabel('Whisper', {exact:true})).toHaveCount(0);
});
