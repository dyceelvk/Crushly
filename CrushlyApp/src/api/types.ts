import type { LiveEdit } from '../lib/videoEdit';

export type Photo = { id: number; url: string };

export type Intention = 'dating' | 'relationship' | 'friends' | 'casual' | 'new_connections' | 'not_sure';

export type Lifestyle = Partial<{
  work: string;
  education: string;
  height: number;
  workout: string;
  drinking: string;
  smoking: string;
  pets: string;
  zodiac: string;
}>;

/**
 * Add Up, read from your side of the pair.
 *
 * `sent` and `received` mean *a request is waiting* — not "somebody once felt
 * something". An accepted request is a connection (`mutual`); a declined one is
 * neither, and `sentStatus` carries that so a screen can say what happened
 * instead of pretending the question is still open.
 */
export type AddUpStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | null;

export type CrushState = {
  /** A request from me is waiting for them. */
  sent: boolean;
  sentStatus: AddUpStatus;
  sentDeep: boolean;
  /** A request from them is waiting for me — Accept / Decline go here. */
  received: boolean;
  receivedStatus: AddUpStatus;
  receivedDeep: boolean;
  note: string | null;
  /** When my request was answered, if it has been. */
  respondedAt: number | null;
  mutual: boolean;
};

export type BadgeTier = 'none' | 'verified' | 'gold' | 'diamond';

export type Profile = {
  id: number;
  name: string;
  username: string | null;
  age: number | null;
  pronouns: string | null;
  city: string | null;
  verified: boolean;
  /**
   * Which seal, when there is one. 'verified' is the ordinary badge; 'gold' is
   * earned; 'diamond' belongs to the company's own account and to nothing else.
   */
  badgeTier?: BadgeTier;
  /** Keep Close — Holup's follow. True when they keep *you* close. */
  keepsYou?: boolean;
  distance: string | null;
  online: boolean | null;
  activity: string | null;
  bio: string;
  intentions: Intention[];
  relationshipIntention: string | null;
  interests: string[];
  sharedInterests: string[];
  photos: Photo[];
  crush: CrushState;
  canMessage: boolean;
  acceptsCrushes: boolean;
  at?: number;
};

/** A post in the Flow: does not expire, unlike a Moment. */
export type PostAudience = 'connections' | 'everyone' | 'circle' | 'private';

/**
 * What you can say about a post. The same five words a Moment accepts, so the
 * product has one reaction vocabulary instead of two.
 */
export type ReactionKind = 'crush' | 'fire' | 'laugh' | 'wow' | 'clap';

export const REACTION_KINDS: ReactionKind[] = ['crush', 'fire', 'laugh', 'wow', 'clap'];

export type Post = {
  id: number;
  body: string;
  mediaUrl: string | null;
  /** Whether the media is a photo or a clip. Null when the post has no media. */
  mediaKind: 'photo' | 'video' | null;
  /** Words and stickers drawn over a clip. Null when the post is not a clip. */
  edit: LiveEdit | null;
  audience: PostAudience;
  /** Set when the post was written into a Circle; null everywhere else. */
  circleId: number | null;
  createdAt: number;
  author: Profile;
  mine: boolean;
  /** How many have liked it, whether you are one of them, how many comments. */
  likeCount: number;
  liked: boolean;
  commentCount: number;
  /** Distinct qualifying viewers, excluding the post author. */
  viewCount?: number | null;
  /**
   * What you said, if you said anything. Null when you have not reacted.
   * Optional because post objects reach the client from cached pages written
   * before reactions had a kind.
   */
  myReaction?: ReactionKind | null;
  /** Every reaction on the post, counted by kind. Absent when nobody reacted. */
  reactionKinds?: Partial<Record<ReactionKind, number>>;
  /** Whether you have kept this for later. */
  saved?: boolean;
  /** The sound this clip is under, when it has one. */
  sound?: PostSound | null;
};

/** One comment left on a post. */
export type PostComment = {
  id: number;
  body: string;
  createdAt: number;
  mine: boolean;
  author: Profile;
  /** Null for a comment left on the post; set for a reply to another comment. */
  parentId?: number | null;
  /** A removed comment keeps its row so its replies do not vanish with it. */
  hidden?: boolean;
  likeCount?: number;
  liked?: boolean;
  replyCount?: number;
  /** Yours to remove, or the post is yours and the comment was left on it. */
  canDelete?: boolean;
};

/** The sound a clip is under. Null for a post that carries no audio. */
export type PostSound = {
  id: number;
  title: string;
  ownerId: number;
};

/** One page of a sound: who owns it, how much is on it, and the clips you may see. */
export type SoundPage = {
  sound: {
    id: number;
    title: string;
    createdAt: number;
    postCount: number;
    owner: Profile;
  };
  items: Post[];
};

/** One person who reacted to a post, for the Likes tab over a post. */
export type PostLiker = {
  kind: ReactionKind;
  createdAt: number;
  author: Profile;
};

/** What Keep Close looks like from one member's Space. */
export type KeepState = {
  keeps: boolean;
  keepsYou: boolean;
  keepsCount: number;
  keptByCount: number;
  self: boolean;
};

export type CloseOne = {
  member: Profile;
  keepsYou: boolean;
  keptAt: number;
};

export type CircleRole = 'owner' | 'member';

/** How a room takes new people. Two settings, not one: see `Circle.discoverable`. */
export type CircleJoinPolicy = 'request' | 'open' | 'invite';

/** Where you stand with a room, in one word the button can be built from. */
export type CircleStanding = 'none' | 'member' | 'pending' | 'invited';

/**
 * A Circle you could walk into.
 *
 * Everything here is a fact a stranger may know about a room: who runs it, how
 * big it is, how alive it has been this week, and where you stand. Its posts and
 * its conversation are not in this type, and never will be — finding a room is
 * not reading it.
 */
export type DiscoverCircle = {
  id: number;
  name: string;
  about: string;
  theme: string | null;
  coverUrl: string | null;
  createdAt: number;
  ownerId: number;
  ownerName: string;
  ownerUsername: string | null;
  ownerPhoto: string | null;
  memberCount: number;
  capacity: number;
  discoverable: boolean;
  joinPolicy: CircleJoinPolicy;
  postsThisWeek: number;
  messagesThisWeek: number;
  posts: number;
  messages: number;
  friendsInside: number;
  state: CircleStanding;
};

/** One room, seen from outside — including by a member. */
export type CirclePreview = {
  circle: Circle & { capacity: number };
  owner: Profile;
  members: Profile[];
  activity: {
    posts: number;
    postsThisWeek: number;
    messagesThisWeek: number;
    reactionsThisWeek: number;
    lastActivityAt: number;
  };
  state: CircleStanding;
  myRole: CircleRole | null;
  full: boolean;
};

/** An invitation waiting on you. */
export type CircleInvitation = {
  id: number;
  circleId: number;
  circleName: string;
  about: string;
  theme: string | null;
  coverUrl: string | null;
  memberCount: number;
  createdAt: number;
  invitedBy: Profile;
  state: 'invited';
};

/** The owner's desk: the four lists, and the two switches behind them. */
export type CircleManage = {
  circle: {
    id: number;
    name: string;
    about: string;
    theme: string | null;
    coverUrl: string | null;
    discoverable: boolean;
    joinPolicy: CircleJoinPolicy;
    capacity: number;
  };
  members: { member: Profile; role: CircleRole; joinedAt: number }[];
  requests: { id: number; requestedAt: number; member: Profile }[];
  declined: { id: number; requestedAt: number; decidedAt: number | null; member: Profile }[];
  invitations: { id: number; createdAt: number; member: Profile }[];
};

/** Somebody the owner could invite. */
export type CircleInviteCandidate = {
  member: Profile;
  connected: boolean;
  invited: boolean;
};

export type Circle = {
  id: number;
  name: string;
  about: string;
  coverUrl: string | null;
  /** What kind of room it is — a slug from `lib/circleThemes`, or the owner's words. */
  theme?: string | null;
  /** `public` means findable on the owner's Space. A Circle is never readable. */
  visibility?: 'connections' | 'public';
  /**
   * Whether people who are not in the room may find it at all — in discovery,
   * in a preview, on somebody's Space. Independent of how they get in.
   */
  discoverable?: boolean;
  /**
   * What happens when somebody who found it knocks.
   *
   *   request  they ask, the owner answers. A pending request grants nothing.
   *   open     they are in immediately.
   *   invite   there is no knocking. The owner adds people.
   */
  joinPolicy?: CircleJoinPolicy;
  /** Owner only: how many people are waiting at the door. */
  pendingRequests?: number;
  createdAt: number;
  ownerId: number;
  myRole: CircleRole;
  muted: boolean;
  memberCount: number;
};

/** A Circle as it appears in your list: the room plus what is new in it. */
export type CircleSummary = Circle & {
  lastMessageAt: number | null;
  unreadCount: number;
};

/**
 * The most engaged thing in one of your Circles.
 *
 * Every field is a fact about a row: `likes` and `comments` are counted from
 * `post_reactions` and `post_comments`, `messages` from the room's own
 * conversation. `kind` says which of those earned the card its place.
 */
export type CircleHighlight = {
  circleId: number;
  circleName: string;
  theme: string | null;
  coverUrl: string | null;
  memberCount: number;
  postId: number | null;
  body: string | null;
  mediaUrl: string | null;
  likes: number;
  comments: number;
  messages: number;
  totalMessages: number;
  kind: 'post' | 'conversation' | 'quiet';
  score: number;
};

/** Somebody waiting to be let into a Circle you started. */
export type CircleJoinRequest = {
  id: number;
  circleId: number;
  circleName: string;
  createdAt: number;
  member: Profile;
};

export type CircleMember = {
  member: Profile;
  role: CircleRole;
  joinedAt: number;
};

export type CircleSpace = {
  circle: Circle;
  members: CircleMember[];
};

export type CircleMessageKind = 'text' | 'photo' | 'voice' | 'video';

export type CircleMessage = {
  id: number;
  circleId: number;
  senderId: number;
  mine: boolean;
  kind: CircleMessageKind;
  body: string;
  mediaUrl: string | null;
  /** Words and stickers drawn over a clip. Null when the message is not a clip. */
  edit: LiveEdit | null;
  createdAt: number;
};

export type CircleListPage = { items: CircleSummary[] };
export type CircleMessagesPage = { items: CircleMessage[] };

export type FlowPage = {
  items: Post[];
  /**
   * Where the next page starts, or null at the end.
   *
   * Both Crushes and a Space used to return `items` and nothing else, so a feed
   * was exactly one page long — twenty posts and then silence, which reads as
   * "my posts are gone" rather than "that is the whole feed". The value is the
   * id of the last row, the same thing the pager sends back as `p_after`.
   */
  nextCursor?: number | null;
};

/**
 * Why a post is where it is. Returned with every item from the ranked Flow so a
 * "why am I seeing this" sheet can be honest, and so the ranking can be debugged
 * from the client without a database session.
 */
export type PostRank = {
  position: number;
  score: number;
  velocity: number;
  recency: number;
  affinity: number;
  explore: number;
  diversityRank: number;
  seenBefore: boolean;
};

export type RankedPost = Post & { rank?: PostRank };

/** The cursor is opaque to the client: hand it back exactly as it arrived. */
export type FlowCursor = { score: number; id: number };

export type RankedFlowPage = {
  items: RankedPost[];
  nextCursor: FlowCursor | null;
  ranking?: { candidates: number; fresh: number; returned: number };
};

/** A stored quote of the message a Whisper is answering — built server-side. */
export type ReplyQuote = {
  id: number;
  mine: boolean;
  name: string | null;
  preview: string | null;
};

export type MomentSummary = {
  id: number;
  kind: 'photo' | 'text' | 'video';
  body: string;
  mediaUrl: string | null;
  style: MomentStyle;
  /** Words and stickers drawn over a clip. Null when the Moment is not a clip. */
  edit: LiveEdit | null;
  /** Clip playback length after trimming and speed, in milliseconds. */
  durationMs: number | null;
  createdAt: number;
};

export type FullProfile = Profile & {
  languages: string[];
  lifestyle: Lifestyle;
  messageBlockReason: string | null;
  moments: MomentSummary[];
};

export type Privacy = {
  showDistance: boolean;
  showOnline: boolean;
  /** Being seen online and being timestamped are different disclosures. */
  showActivity: boolean;
  readReceipts: boolean;
  discoverable: boolean;
  profileVisibility: 'everyone' | 'connections';
  whoCanMessage: 'everyone' | 'crushes' | 'mutual';
  whoCanCrush: 'everyone' | 'verified';
  showAge: boolean;
  showCity: boolean;
  incognito: boolean;
};

export type Preferences = {
  ageMin: number;
  ageMax: number;
  maxDistance: number;
  intentions: Intention[];
  interests: string[];
  verifiedOnly: boolean;
};

export type NotificationSettings = { messages: boolean; crushes: boolean; moments: boolean; recommendations: boolean };

export type VerificationStatus = 'none' | 'pending' | 'verified' | 'rejected';

export type Me = {
  id: number;
  email: string;
  status: 'active' | 'paused';
  createdAt: number;
  onboarded: boolean;
  profile: {
    name: string;
    username: string;
    birthdate: string | null;
    age: number | null;
    pronouns: string;
    bio: string;
    city: string;
    hasLocation: boolean;
    intentions: Intention[];
    interests: string[];
    languages: string[];
    relationshipIntention: string;
    lifestyle: Lifestyle;
    photos: Photo[];
  };
  verification: { status: VerificationStatus; pose: string | null };
  completion: { percent: number; missing: string[] };
  preferences: Preferences;
  privacy: Privacy;
  notifications: NotificationSettings;
  plus: { active: boolean; interested: boolean; deepCrushesLeft: number; deepCrushesPerDay: number };
};

export type DiscoverPage = { items: Profile[]; nextOffset: number | null; total: number; viewerHasLocation: boolean };

export type CrushesResponse = {
  /** Requests waiting for an answer from me. */
  incoming: Profile[];
  /** Requests of mine waiting for an answer. */
  outgoing: Profile[];
  /** Connections. */
  mutual: Profile[];
  /** How many requests are waiting for me, for the badge. */
  requestCount: number;
};

/**
 * The Whisper header's three questions, answered by the database once and then
 * kept live by the conversation's channel.
 *
 * `online` and `activity` are null when either side has switched that
 * visibility off — which the screen must treat as "nothing to say", not as
 * "offline".
 */
export type PeerPresence = {
  peerId: number;
  online: boolean | null;
  activity: string | null;
  /** Read receipts need both members; false means no tick is ever shown. */
  receipts: boolean;
  /** May this member's own presence be announced on the channel? */
  announce: boolean;
  closed: boolean;
};

export type Peer = { id: number; name: string; verified: boolean; photo: string | null; online: boolean | null };

export type MessageKind = 'text' | 'photo' | 'voice' | 'video' | 'call' | 'sticker' | 'profile' | 'post' | 'moment_reply';

export type Message = {
  id: number;
  conversationId: number;
  senderId: number;
  mine: boolean;
  kind: MessageKind;
  body: string;
  mediaUrl: string | null;
  meta: Record<string, any>;
  createdAt: number;
  readAt: number | null;
  /**
   * When the other device actually had this message — the sender's information,
   * and only ever present on messages I sent. Delivery is not a receipt: it says
   * "arrived", never "read".
   */
  deliveredAt?: number | null;
  reactions: { userId: number; kind: string }[];
  /** client-only: optimistic send state */
  pending?: boolean;
  failed?: boolean;
  localId?: string;
};

export type ConversationSummary = {
  id: number;
  peer: Peer;
  lastMessage: Message | null;
  unread: number;
  updatedAt: number;
};

export type ConversationDetail = {
  id: number;
  closed: boolean;
  peer: Peer;
  canSend: boolean;
  blockReason: string | null;
};

export type MomentStyle = 'noir' | 'champagne' | 'crimson' | 'midnight' | 'emerald';

export type Moment = MomentSummary & {
  userId: number;
  audience: 'everyone' | 'connections';
  expiresAt: number;
  seen: boolean;
  myReaction: string | null;
  viewCount?: number;
  reactions?: { kind: string; userId: number; name: string }[];
};

export type MomentAuthor = {
  id: number; name: string; verified: boolean; badgeTier?: BadgeTier; photo: string | null; mutual: boolean;
};

export type MomentGroup = { user: MomentAuthor; moments: Moment[]; hasUnseen: boolean; latestAt: number };

export type MomentsFeed = { mine: { user: MomentAuthor; moments: Moment[] }; others: MomentGroup[] };

export type NotificationKind =
  | 'crush'
  | 'deep_crush'
  | 'mutual'
  | 'message'
  | 'moment_reply'
  | 'moment_reaction'
  | 'verified'
  | 'verification_rejected'
  | 'post_reaction'
  | 'post_comment'
  /** Somebody named you with `@handle`. `refId` is the post it was written in. */
  | 'post_mention'
  /**
   * Somebody started keeping you close. Not a connection request and not an
   * event that needs answering: it opens their Space and nothing else.
   */
  | 'keep'
  /**
   * The four things a Circle can say. `refId` is the Circle's id, not a
   * request id: every one of them is answered by opening the room.
   */
  | 'circle_request'
  | 'circle_approved'
  | 'circle_declined'
  | 'circle_invite'
  /** The owner's side of the same door: somebody is now in *your* room. */
  | 'circle_joined';

export type AppNotification = {
  id: number;
  kind: NotificationKind;
  body: string;
  refId: number | null;
  createdAt: number;
  read: boolean;
  actor: { id: number; name: string; verified: boolean; photo: string | null } | null;
};

export type Badges = {
  notifications: number;
  messages: number;
  crushes: number;
  latestNotification: { id: number; kind: NotificationKind; body: string; actor_id: number | null; actor_name: string | null } | null;
};

export type BlockedMember = { id: number; name: string; photo: string | null; blockedAt: number };

export type CrushResult = {
  mutual: boolean;
  isNew: boolean;
  /** What the pair is now: a request waiting, an answer, or an existing connection. */
  request: 'pending' | 'accepted' | 'connected';
  profile: Profile | null;
};

/* ----------------------------------------------------------------- search */

/** The author a search result carries — the same shape a feed row uses. */
export type SearchAuthor = { id: number; name: string; verified: boolean; photo?: string | null; photos?: Photo[]; mutual?: boolean };

export type SearchPost = {
  id: number;
  body: string;
  mediaUrl: string | null;
  audience: 'connections' | 'everyone';
  mediaKind?: 'photo' | 'video' | null;
  createdAt: number;
  author: SearchAuthor;
};

export type SearchMoment = {
  id: number;
  mine: boolean;
  kind: 'text' | 'photo' | 'video';
  body: string;
  mediaUrl: string | null;
  createdAt: number;
  author: SearchAuthor;
};

export type SearchCategory = 'top' | 'clips' | 'photos' | 'people' | 'sounds' | 'places' | 'hashtags' | 'moments';
export type SearchFilters = { place: string; hashtag: boolean; since: number; sort: 'relevance' | 'newest'; author: string; content: 'all' | 'clip' | 'photo' | 'text' };

/** What the search box returns: members, and what they have shared. */
export type SearchResults = {
  members: Profile[];
  posts: SearchPost[];
  moments: SearchMoment[];
  sounds: { id: number; title: string }[];
  places: { name: string }[];
  hashtags: { tag: string }[];
};

/** What our own update endpoint says the current build is. */
export type AppUpdate = {
  platform: string;
  version: string;
  versionCode: number;
  minVersionCode: number;
  apkUrl: string | null;
  /** Short-lived signed APK URL resolver, used before opening a native download. */
  downloadInfoUrl: string | null;
  /** Size and SHA-256 of the file the endpoint is offering. */
  bytes?: number | null;
  sha256?: string | null;
  notes: string;
};

/** A viewer whose profile may be hidden by their own privacy settings. */
export type ViewerItem = { profile: Profile | null; viewedAt: number };
export type ViewerPage = { items: ViewerItem[]; count?: number };
