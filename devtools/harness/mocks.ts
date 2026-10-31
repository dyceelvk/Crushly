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

const now = 1793430000000;

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

const conversations = [
  {
    id: 1,
    peer: { id: 2, name: 'Ngozi', verified: true, photo: `${MEDIA}/face2.jpg`, online: true },
    lastMessage: 'okay that clip is unreal',
    lastAt: now - 1000 * 60 * 6,
    unreadCount: 1,
    mine: false,
  },
  {
    id: 2,
    peer: { id: 3, name: 'Tunde', verified: false, photo: `${MEDIA}/face3.jpg`, online: false },
    lastMessage: 'sent a photo',
    lastAt: now - 1000 * 60 * 60,
    unreadCount: 0,
    mine: true,
  },
];

const closeOnes = {
  items: [
    { id: 2, name: 'Ngozi', username: 'ngozi', photoUrl: `${MEDIA}/face2.jpg`, since: now - 86400000 * 40, note: null },
    { id: 3, name: 'Tunde', username: 'tunde', photoUrl: `${MEDIA}/face3.jpg`, since: now - 86400000 * 12, note: null },
    { id: 4, name: 'Amara', username: 'amara', photoUrl: `${MEDIA}/face4.jpg`, since: now - 86400000 * 3, note: null },
  ],
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
  [['conversations'], { items: conversations }],
  [['app-update'], { available: false, latestVersion: '1.0.3', url: null }],
  [['blocks'], { items: [] }],
  [['notifications'], { items: [], unread: 0 }],
  [['crushes'], { incoming: [person(5, 'Chidi', 'chidi'), person(6, 'Bisi', 'bisi')], outgoing: [person(7, 'Emeka', 'emeka')], mutual: [] }],
  [['close-ones'], closeOnes],
  [['user', 2], person(2, 'Ngozi', 'ngozi', { bio: 'Filmmaker. I make small films about big feelings.', verified: true, intentions: ['dating'], relationshipIntention: 'Long-term partner' })],
  [['badges'], { items: [] }],
];

export const mockPosts = posts;
export const mockComments = comments;
