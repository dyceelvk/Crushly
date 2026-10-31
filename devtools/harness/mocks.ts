/**
 * Mock rows for the render harness. Enough shape for every screen to draw
 * realistically; nothing here is used by the app itself.
 *
 * Media points at files served by the harness's own http server, so a render
 * does not depend on anything on the internet. The two clips are the point of
 * the video work: one landscape, one portrait, so a crop cannot hide.
 */

const MEDIA = 'http://127.0.0.1:8097/media';

const crush = { sent: false, sentDeep: false, received: false, receivedDeep: false, note: null, mutual: false };

const person = (id: number, name: string, username: string, opts: Partial<any> = {}) => ({
  id,
  name,
  username,
  age: 27,
  pronouns: 'she/her',
  city: 'Port Harcourt',
  verified: false,
  distance: '5 km',
  online: true,
  activity: null,
  bio: '',
  intentions: [],
  relationshipIntention: null,
  interests: [],
  sharedInterests: [],
  photos: [{ id: id * 10, url: `${MEDIA}/face${(id % 4) + 1}.jpg` }],
  crush,
  canMessage: true,
  acceptsCrushes: true,
  ...opts,
});

export const me = {
  id: 1,
  email: 'ada@example.com',
  status: 'active' as const,
  createdAt: 1759000000000,
  onboarded: true,
  profile: {
    name: 'Ada',
    username: 'ada',
    birthdate: '1998-04-11',
    age: 28,
    pronouns: 'she/her',
    bio: 'Designer. Long walks, longer playlists.',
    city: 'Port Harcourt',
    hasLocation: true,
    intentions: ['dating', 'friends'],
    interests: ['Music', 'Design', 'Coffee'],
    languages: ['English'],
    relationshipIntention: 'Long-term partner',
    lifestyle: {},
    photos: [
      { id: 11, url: `${MEDIA}/face1.jpg` },
      { id: 12, url: `${MEDIA}/face2.jpg` },
    ],
  },
  verification: { status: 'none' as const, pose: null },
  // Mirrors `completion()` in api/service.ts for exactly this mock: two photos,
  // a 39-character bio, three interests, one language, no lifestyle answers.
  // It used to say `missing: ['photos']`, which is not a label that function can
  // ever produce — the screen was being rendered against a fiction.
  completion: { percent: 85, missing: ['Add at least 3 photos', 'Lifestyle details'] },
  preferences: { ageMin: 24, ageMax: 38, maxDistance: 50, intentions: ['dating'], interests: [], verifiedOnly: false },
  privacy: {
    showDistance: true, showOnline: true, readReceipts: true, discoverable: true,
    profileVisibility: 'everyone' as const, whoCanMessage: 'crushes' as const, whoCanCrush: 'everyone' as const,
    showAge: true, showCity: true, incognito: false,
  },
  notifications: { messages: true, crushes: true, moments: true, recommendations: false },
  plus: { active: false, interested: false, deepCrushesLeft: 3, deepCrushesPerDay: 3 },
};

// Live clock, not a frozen one: the screens print relative times against
// Date.now(), so a fixture stamped at build time would read "9h" forever.
const now = Date.now();

const posts: any[] = [
  {
    id: 101,
    body: 'Six months of building this thing and today it finally feels like a place rather than a product. Come see.',
    mediaUrl: `${MEDIA}/scene1.jpg`,
    mediaKind: 'photo' as const,
    edit: null,
    createdAt: now - 1000 * 60 * 5,
    author: person(1, 'Ada', 'ada'),
    likeCount: 24,
    commentCount: 3,
    crushCount: 9,
    liked: false,
    saved: false,
    audience: 'everyone' as const,
    reactionKinds: { crush: 6, like: 18 },
    mine: true,
  },
  // A landscape clip: 16:9. In the old feed this was drawn in a 4:5 box, so it
  // either lost its left and right thirds or floated as a band in black.
  {
    id: 102,
    body: 'Shot this on the drive home. Landscape, because I forgot to turn the phone.',
    mediaUrl: `${MEDIA}/video-landscape.webm`,
    mediaKind: 'video' as const,
    edit: null,
    createdAt: now - 1000 * 60 * 40,
    author: person(2, 'Ngozi', 'ngozi'),
    likeCount: 12,
    commentCount: 2,
    crushCount: 3,
    liked: false,
    saved: false,
    audience: 'everyone' as const,
    reactionKinds: { crush: 2 },
    mine: false,
  },
  // A portrait clip: 9:16. The old box cropped it, or squeezed it.
  {
    id: 103,
    body: 'Portrait, the way a phone is meant to be held.',
    mediaUrl: `${MEDIA}/video-portrait.webm`,
    mediaKind: 'video' as const,
    edit: null,
    createdAt: now - 1000 * 60 * 20,
    author: person(3, 'Tunde', 'tunde'),
    likeCount: 8,
    commentCount: 1,
    crushCount: 1,
    liked: false,
    saved: false,
    audience: 'everyone' as const,
    reactionKinds: {},
    mine: false,
  },
];

const comments = [
  {
    id: 1,
    postId: 101,
    body: 'This is the one. Proud of you.',
    mine: false,
    createdAt: now - 1000 * 60 * 3,
    author: person(2, 'Ngozi', 'ngozi'),
    likeCount: 2,
    liked: false,
  },
  {
    id: 2,
    postId: 101,
    body: 'The place feeling is real.',
    mine: true,
    createdAt: now - 1000 * 60 * 2,
    author: person(1, 'Ada', 'ada'),
    likeCount: 0,
    liked: false,
  },
  {
    id: 3,
    postId: 102,
    body: 'Where is this?',
    mine: false,
    createdAt: now - 1000 * 60 * 30,
    author: person(4, 'Amara', 'amara'),
    likeCount: 1,
    liked: false,
  },
];

const circles = [
  { id: 1, name: 'Sunday People', memberCount: 6, unreadCount: 2, photoUrl: `${MEDIA}/face2.jpg`, lastMessage: 'see you at 4' },
  { id: 2, name: 'Design Room', memberCount: 4, unreadCount: 0, photoUrl: null, lastMessage: 'the new build is up' },
];

/** A Message exactly as `serialize_message` builds it — `meta` always an object,
 *  timestamps in epoch milliseconds (`now_ms()`), `readAt` null when unread. */
const message = (
  id: number,
  conversationId: number,
  senderId: number,
  mine: boolean,
  body: string,
  createdAt: number,
  opts: Partial<any> = {},
): any => ({
  id,
  conversationId,
  senderId,
  mine,
  kind: 'text',
  body,
  mediaUrl: null,
  meta: {},
  createdAt,
  readAt: null,
  reactions: [],
  ...opts,
});

/** `list_conversations()` unwrapped — the service hands the screen a plain
 *  array, so that is what the cache must hold. */
const conversations = [
  {
    id: 1,
    peer: { id: 2, name: 'Ngozi', verified: true, photo: `${MEDIA}/face2.jpg`, online: true },
    lastMessage: message(11, 1, 2, false, 'okay that clip is unreal', now - 1000 * 60 * 6),
    unread: 1,
    updatedAt: now - 1000 * 60 * 6,
  },
  {
    id: 2,
    peer: { id: 3, name: 'Tunde', verified: false, photo: `${MEDIA}/face3.jpg`, online: false },
    lastMessage: message(12, 2, 1, true, '', now - 1000 * 60 * 60, {
      kind: 'photo',
      mediaUrl: `${MEDIA}/scene2.jpg`,
      readAt: now - 1000 * 60 * 52,
    }),
    unread: 0,
    updatedAt: now - 1000 * 60 * 60,
  },
  {
    id: 3,
    peer: { id: 4, name: 'Amara', verified: false, photo: null, online: null },
    lastMessage: message(13, 3, 4, false, 'Voice note', now - 1000 * 60 * 60 * 26, { kind: 'voice' }),
    unread: 4,
    updatedAt: now - 1000 * 60 * 60 * 26,
  },
];

/**
 * The thread on `Chat` (`get_messages` → `items`). Newest last: the screen
 * inverts the list itself. Deliberately mixed — a five-minute gap, a day
 * boundary, a photo, a reply, a self-sent message already read — because those
 * are the cases the grouping and the seen-tick have to get right.
 */
export const threads: Record<number, { items: any[]; hasMore: boolean; lastReadMine: number | null }> = {
  1: {
    items: [
      message(1, 1, 1, true, 'That rooftop shot is doing something to me. Where is it?', now - 1000 * 60 * 60 * 30),
      message(2, 1, 2, false, 'Aba Road, the one with the blue gate. Go at 6, not 5.', now - 1000 * 60 * 60 * 29),
      message(3, 1, 1, true, 'Noted. Bringing the good camera.', now - 1000 * 60 * 60 * 29, { readAt: now - 1000 * 60 * 28 }),
      message(4, 1, 2, false, '', now - 1000 * 60 * 60 * 28, { kind: 'photo', mediaUrl: `${MEDIA}/scene1.jpg` }),
      message(5, 1, 1, true, 'Okay that clip is unreal.', now - 1000 * 60 * 8),
      message(6, 1, 1, true, 'How long did you wait for the light?', now - 1000 * 60 * 7),
      message(7, 1, 1, true, 'I have never had the patience.', now - 1000 * 60 * 6),
      message(8, 1, 2, false, 'Six minutes. Then the sky did the rest.', now - 1000 * 60 * 5),
    ],
    hasMore: false,
    lastReadMine: 5,
  },
};

const closeOnes = {
  items: [
    { id: 2, name: 'Ngozi', username: 'ngozi', photoUrl: `${MEDIA}/face2.jpg`, since: now - 86400000 * 40, note: null },
    { id: 3, name: 'Tunde', username: 'tunde', photoUrl: `${MEDIA}/face3.jpg`, since: now - 86400000 * 12, note: null },
    { id: 4, name: 'Amara', username: 'amara', photoUrl: `${MEDIA}/face4.jpg`, since: now - 86400000 * 3, note: null },
  ],
};

/* ------------------------------------------------------------- mock transport */

const conversationDetail = (id: number) => {
  const conv = conversations.find((c) => c.id === id) ?? conversations[0];
  return { id: conv.id, closed: false, peer: conv.peer, canSend: true, blockReason: null };
};

/**
 * Answers the RPCs a screen calls through its hooks.
 *
 * The cache above only covers screens that read `useQuery` keys verbatim;
 * anything that goes through `useChat` or a mutation calls `service.*`, which
 * calls `supabase.rpc`. Overriding that one method means a render exercises the
 * real hooks, the real service, and the real shapes — the same boundary the app
 * uses — instead of a hand-seeded payload that can quietly disagree with it.
 *
 * Anything not listed here rejects, so a missing mock is loud instead of silent.
 */
export async function mockRpc(fn: string, args: Record<string, any> = {}): Promise<unknown> {
  switch (fn) {
    case 'list_conversations':
      return { items: conversations };
    case 'load_conversation':
      return conversationDetail(Number(args.p_conversation_id));
    case 'get_messages': {
      const thread = threads[Number(args.p_conversation_id)] ?? { items: [], hasMore: false, lastReadMine: null };
      const after = Number(args.p_after_id ?? 0);
      const items = after ? thread.items.filter((m) => m.id > after) : thread.items;
      return { items, hasMore: thread.hasMore, lastReadMine: thread.lastReadMine };
    }
    case 'mark_conversation_read':
      return true;
    case 'send_message': {
      const thread = threads[Number(args.p_conversation_id)];
      const last = thread?.items[thread.items.length - 1];
      return message(
        (last?.id ?? 0) + 1,
        Number(args.p_conversation_id),
        1,
        true,
        String(args.p_body ?? ''),
        Date.now(),
        { kind: String(args.p_kind ?? 'text'), meta: args.p_meta ?? {}, readAt: null },
      );
    }
    case 'toggle_message_reaction':
      return { id: Number(args.p_message_id), reactions: [{ userId: 1, kind: String(args.p_kind ?? 'crush') }] };
    case 'public_flow_feed':
      return { items: posts.filter((p) => p.audience !== 'connections') };
    case 'vibes_feed':
      return { items: vibes };
    case 'search_all':
      // Filtered by the query, like the real `search_all()`. A mock that ignores
      // what was typed makes a screenshot that "proves" search returns the wrong
      // people — the failure mode this harness exists to avoid.
      return filterSearch(String(args.p_query ?? ''));
    case 'crushes_feed':
      return { incoming: [person(5, 'Chidi', 'chidi'), person(6, 'Bisi', 'bisi')], outgoing: [person(7, 'Emeka', 'emeka')], mutual: [person(8, 'Kelechi', 'kelechi')] };
    default:
      throw new Error(`harness: no mock for ${fn}()`);
  }
}

/* ------------------------------------------------------- discover fixtures */

/** A Moment as `visible_moments()` serves it: flat, with the author attached. */
const moment = (id: number, userId: number, author: any, body: string, createdAt: number, opts: Partial<any> = {}): any => ({
  id,
  userId,
  kind: 'photo',
  body,
  mediaUrl: `${MEDIA}/scene${(id % 4) + 1}.jpg`,
  style: 'champagne',
  edit: null,
  createdAt,
  audience: 'everyone',
  expiresAt: createdAt + 86400000,
  seen: false,
  myReaction: null,
  viewCount: 12,
  author,
  ...opts,
});

const authors = {
  kelechi: { id: 8, name: 'Kelechi', verified: false, photo: `${MEDIA}/face4.jpg`, mutual: true },
  ngozi: { id: 2, name: 'Ngozi', verified: true, photo: `${MEDIA}/face2.jpg`, mutual: true },
  chidi: { id: 5, name: 'Chidi', verified: false, photo: `${MEDIA}/face1.jpg`, mutual: false },
};

/** The grouped feed the screen actually reads — `momentsFeed()` returns this
 *  shape, not the flat rows (the service groups them in `lib/moments.ts`). */
export const momentsFeed = {
  mine: { user: { id: 1, name: 'Ada', verified: false, photo: `${MEDIA}/face1.jpg`, mutual: false }, moments: [] as any[] },
  others: [
    {
      user: authors.ngozi,
      hasUnseen: true,
      latestAt: now - 1000 * 60 * 20,
      moments: [
        moment(1, 2, authors.ngozi, 'Blue hour on Aba Road.', now - 1000 * 60 * 90),
        moment(2, 2, authors.ngozi, 'Six minutes of waiting.', now - 1000 * 60 * 20),
      ],
    },
    {
      user: authors.kelechi,
      hasUnseen: false,
      latestAt: now - 1000 * 60 * 60 * 3,
      moments: [moment(3, 8, authors.kelechi, 'Sunday people, Sunday light.', now - 1000 * 60 * 60 * 3)],
    },
    // Somebody nearby rather than in your connections: the second section, and
    // the words-only Moment (no photo to hide behind).
    {
      user: authors.chidi,
      hasUnseen: false,
      latestAt: now - 1000 * 60 * 60 * 7,
      moments: [moment(4, 5, authors.chidi, 'Rain on the roof and nowhere to be.', now - 1000 * 60 * 60 * 7, { kind: 'text', style: 'midnight', mediaUrl: null })],
    },
  ],
};

/** The same feed with a clip in it, for the video branch of the viewer. */
export const momentsFeedVideo = {
  mine: momentsFeed.mine,
  others: [
    {
      user: { ...authors.chidi, name: 'Chidi', mutual: true },
      hasUnseen: true,
      latestAt: now - 1000 * 60 * 5,
      moments: [
        moment(11, 5, { ...authors.chidi, name: 'Chidi' }, 'Sound on. It is worth it.', now - 1000 * 60 * 5, {
          kind: 'video',
          mediaUrl: `${MEDIA}/video-portrait.webm`,
        }),
      ],
    },
  ],
};

const vibe = (id: number, author: any, body: string, createdAt: number, opts: Partial<any> = {}): any => ({
  id,
  body,
  mediaUrl: `${MEDIA}/video-portrait.webm`,
  coverUrl: `${MEDIA}/scene2.jpg`,
  durationMs: 12_000,
  audience: 'everyone',
  edit: null,
  createdAt,
  expiresAt: createdAt + 86400000,
  author,
  mine: false,
  seen: false,
  viewCount: 143,
  ...opts,
});

export const vibes = [
  vibe(1, { id: 2, name: 'Ngozi', photo: `${MEDIA}/face2.jpg` }, 'The light did all the work.', now - 1000 * 60 * 40),
  vibe(2, { id: 5, name: 'Chidi', photo: `${MEDIA}/face1.jpg` }, 'Sound on. It is worth it.', now - 1000 * 60 * 60 * 5),
];

/** Case-insensitive substring match over the words and names a member can see. */
export function filterSearch(query: string) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return { members: [], posts: [], vibes: [], moments: [] };
  const hit = (...fields: (string | null | undefined)[]) =>
    fields.some((f) => (f ?? '').toLowerCase().includes(q));
  return {
    members: searchResults.members.filter((p) => hit(p.name, p.username, p.city, ...(p.interests ?? []))),
    posts: searchResults.posts.filter((p) => hit(p.body, p.author?.name)),
    vibes: searchResults.vibes.filter((v) => hit(v.body, v.author?.name)),
    moments: [],
  };
}

export const searchResults = {
  members: [person(2, 'Ngozi', 'ngozi', { verified: true }), person(4, 'Amara', 'amara', { photos: [] })],
  posts: posts.slice(0, 2),
  vibes: vibes.slice(0, 1),
  moments: [],
};

/** [query key, data] pairs, seeded into the cache before anything mounts. */
export const mockEntries: [unknown[], unknown][] = [
  [['me'], me],
  [['flow', 20, null], { items: posts }],
  [['post', 101], posts[0]],
  [['post', 102], posts[1]],
  [['post', 103], posts[2]],
  [['post-comments', 101], { items: comments.filter((c) => c.postId === 101) }],
  [['post-comments', 102], { items: comments.filter((c) => c.postId === 102) }],
  [['circles'], { items: circles }],
  [['conversations'], conversations],
  [['app-update'], { available: false, latestVersion: '1.0.3', url: null }],
  [['blocks'], { items: [] }],
  [['notifications'], { items: [], unread: 0 }],
  [['crushes'], { incoming: [person(5, 'Chidi', 'chidi'), person(6, 'Bisi', 'bisi')], outgoing: [person(7, 'Emeka', 'emeka')], mutual: [person(8, 'Kelechi', 'kelechi')] }],
  [['close-ones'], closeOnes],
  [['user', 2], person(2, 'Ngozi', 'ngozi', { bio: 'Filmmaker. I make small films about big feelings.', verified: true, intentions: ['dating'], relationshipIntention: 'Long-term partner' })],
  [['moments'], momentsFeed],
  [['badges'], { items: [], notifications: 2, messages: 0 }],
];

export const mockPosts = posts;
export const mockComments = comments;
