/* TEST-ONLY: synthetic, in-memory API. This branch is never released. */
const actor = {id: 2, name: 'Fixture Ada', username:'ada', verified:false, photos:[], photo:null};
const post = {id:11, body:'Offline test post', mediaUrl:null, mediaKind:null, audience:'everyone', createdAt:Date.now(), author:actor, mine:false, likeCount:0, liked:false, commentCount:1, saved:false};
const fixtureProfile = {id:1, name:'Offline test', username:'offline', onboarded:true, status:'active', birthdate:'1995-01-01', verification:'none', email:'offline@example.test', created_at:Date.now()};
const notifications = [
  {id:1, kind:'message', actor, body:'', refId:1, read:true, createdAt:Date.now()},
  {id:2, kind:'post_comment', actor, body:'hello', refId:11, read:true, createdAt:Date.now()},
];
export async function offlineSwipeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const path = new URL(url).pathname;
  let body: unknown = [];
  if (path === '/auth/v1/user') body = {id:'00000000-0000-4000-8000-000000000001', email:'offline@example.test', aud:'authenticated', role:'authenticated'};
  else if (path === '/rest/v1/profiles') body = fixtureProfile;
  else if (path === '/rest/v1/preferences') body = {age_min:18,age_max:99,intentions:[],interests:[]};
  else if (path === '/rest/v1/privacy') body = {profile_visibility:'everyone',discoverable:true};
  else if (path === '/rest/v1/notification_settings') body = {};
  else if (path === '/rest/v1/verification_requests') body = null;
  else if (path === '/rest/v1/rpc/crush_posts_feed') body = {items:[post], nextCursor:null};
  else if (path === '/rest/v1/rpc/public_flow_feed') body = {items:[post]};
  else if (path === '/rest/v1/rpc/flow_feed' || path === '/rest/v1/rpc/flow_ranked_feed') body = {items:[],nextCursor:null};
  else if (path === '/rest/v1/rpc/crushes_feed') body = {incoming:[],outgoing:[],mutual:[],requestCount:0};
  else if (path === '/rest/v1/rpc/list_conversations' || path === '/rest/v1/rpc/close_ones' || path === '/rest/v1/rpc/my_circles') body = {items:[]};
  else if (path === '/rest/v1/rpc/list_notifications') body = notifications;
  else if (path === '/rest/v1/rpc/badges') body = {notifications:0,whispers:0,messages:0,crushes:0,moments:0};
  else if (path === '/rest/v1/rpc/holup_app_settings') body = {callsEnabled:false,publicSharingEnabled:true,announcement:null};
  else if (path === '/rest/v1/rpc/post_comments_feed') body = {items:[{id:45,body:'Offline comment',createdAt:Date.now(),mine:false,author:actor,parentId:null,liked:false,likeCount:0}]};
  else if (path === '/rest/v1/rpc/post_likers') body = {items:[]};
  else if (path === '/rest/v1/rpc/post_comment_settings') body = true;
  else if (path === '/rest/v1/rpc/heartbeat') body = true;
  return new Response(JSON.stringify(body), {status:200, headers:{'content-type':'application/json'}});
}
