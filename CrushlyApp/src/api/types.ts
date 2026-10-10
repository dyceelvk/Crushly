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

export type CrushState = {
  sent: boolean;
  sentDeep: boolean;
  received: boolean;
  receivedDeep: boolean;
  note: string | null;
  mutual: boolean;
};

export type Profile = {
  id: number;
  name: string;
  username: string | null;
  age: number | null;
  pronouns: string | null;
  city: string | null;
  verified: boolean;
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
export type Post = {
  id: number;
  body: string;
  mediaUrl: string | null;
  audience: 'connections' | 'everyone';
  createdAt: number;
  author: Profile;
  mine: boolean;
};

export type FlowPage = {
  items: Post[];
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
  kind: 'photo' | 'text';
  body: string;
  mediaUrl: string | null;
  style: MomentStyle;
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

export type CrushesResponse = { incoming: Profile[]; outgoing: Profile[]; mutual: Profile[] };

export type Peer = { id: number; name: string; verified: boolean; photo: string | null; online: boolean | null };

export type MessageKind = 'text' | 'photo' | 'voice' | 'video' | 'call' | 'sticker' | 'profile' | 'moment_reply';

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

export type MomentAuthor = { id: number; name: string; verified: boolean; photo: string | null; mutual: boolean };

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
  | 'verification_rejected';

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

export type CrushResult = { mutual: boolean; isNew: boolean; profile: Profile | null };
