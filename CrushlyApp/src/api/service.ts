import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { updateVersionPath } from '../lib/updateChannel';
import { browserLocation } from '../lib/browser';
import { profileCompletion } from '../lib/completion';
import { supabase, ApiError, extensionFor, removeMediaFile, requireConfig, toApiError, uploadMediaFile } from './client';
import { backendFromProbe, isMissingFunctionError } from '../lib/relationshipFallback';
import { callMessageMeta } from '../lib/callChannel';
import { MEDIA_BASE_URL } from '../lib/mediaHost';
import { ageFromBirthdate } from '../lib/format';
import { clampMemberAge, isMemberAgeEligible, MINIMUM_MEMBER_AGE } from '../lib/minimumAge';
import { groupMomentFeed, type FeedMoment } from '../lib/moments';
import { profileShape } from '../lib/profileShape';
import type { LiveEdit, VideoEdit } from '../lib/videoEdit';
import type { WhisperState } from '../lib/whisperRequest';
import type { ViewerPage } from './types';
import {
  INTENTIONS as catalogIntentions,
  INTERESTS as catalogInterests,
  LANGUAGES as catalogLanguages,
  RELATIONSHIP_INTENTIONS as catalogRelationshipIntentions,
} from '../lib/catalog';
import type {AppUpdate, AppNotification, Badges, BlockedMember, Circle, CircleListPage, CircleMember, CircleMessage, CircleMessageKind, CircleMessagesPage, CircleSpace, CircleSummary, CircleHighlight, CircleJoinRequest, CirclePreview, DiscoverCircle,
  CircleInvitation, CircleManage, CircleInviteCandidate, CircleJoinPolicy, CircleStanding, CloseOne, ConversationDetail, ConversationSummary, CrushesResponse, CrushResult, DiscoverPage, FlowPage, FullProfile, KeepState, Me, Message, Moment, MomentAuthor, MomentsFeed, Post, PostComment, Preferences, Privacy, ReplyQuote, NotificationSettings, Profile, ReactionKind, MomentStyle, SearchResults, SearchCategory, SearchFilters, FlowCursor, RankedFlowPage, PostLiker, SoundPage, PeerPresence} from './types';

/**
 * The Holup data layer — a 1:1 port of the retired Express API onto Supabase.
 * Simple things are plain table reads/writes on the member's own
 * rows (RLS-protected); everything cross-member runs through the RPCs defined
 * in supabase/migrations/20261008000002_functions.sql.
 */

const FREE_DEEP_CRUSHES_PER_DAY = 3;
const MAX_PHOTOS = 6;

/**
 * Every kind of Whisper can answer another one. `replyTo` is only the id: the
 * quote that gets stored is rebuilt by the database from the original row, so
 * a member cannot put words in someone else's mouth. `replyQuote` is the
 * client's own preview, used for the bubble while the message is still sending.
 */
type ReplyTo = { replyTo?: number; replyQuote?: ReplyQuote };

export type SendDraft =
  | ({ kind: 'text'; body: string } & ReplyTo)
  | ({ kind: 'sticker'; sticker: string } & ReplyTo)
  | ({ kind: 'profile'; profileId: number } & ReplyTo)
  | ({ kind: 'post'; postId: number } & ReplyTo)
  | ({ kind: 'photo'; uri: string; mimeType?: string; caption?: string } & ReplyTo)
  | ({ kind: 'voice'; uri: string; duration: number; mimeType?: string } & ReplyTo)
  | ({ kind: 'video'; uri: string; duration: number; mimeType?: string } & ReplyTo)
  | ({ kind: 'call'; channel: string } & ReplyTo);

const unwrap = <T>(res: { data: T | null; error: unknown }): T => {
  if (res.error) throw toApiError(res.error);
  return res.data as T;
};

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  requireConfig();
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) throw toApiError(error);
    return data as T;
  } catch (e) {
    throw e instanceof ApiError ? e : toApiError(e);
  }
}

function snapCoordinate(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100; // ~1.1 km grid; exact coordinates are never stored
}

const str = (value: unknown, label: string, { max, required = false }: { max: number; required?: boolean }): string => {
  const s = String(value ?? '').trim();
  if (required && !s) throw new ApiError(400, `${label} is required.`);
  if (s.length > max) throw new ApiError(400, `${label} must be ${max} characters or fewer.`);
  return s;
};

const oneOf = <T extends string>(value: unknown, label: string, allowed: readonly T[]): T => {
  const v = String(value ?? '');
  if (!allowed.includes(v as T)) throw new ApiError(400, `That ${label.toLowerCase()} isn’t an option.`);
  return v as T;
};

const cleanList = (value: unknown, label: string, allowed: readonly string[], max: number): string[] => {
  if (!Array.isArray(value)) return [];
  const out = [...new Set(value.map(String))];
  for (const v of out) if (!allowed.includes(v)) throw new ApiError(400, `${label} contains an unknown value.`);
  if (out.length > max) throw new ApiError(400, `${label} can have up to ${max} values.`);
  return out;
};

const cleanJson = (value: unknown, maxBytes = 2000): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const json = JSON.stringify(value);
  if (json.length > maxBytes) throw new ApiError(400, 'That’s a bit too much detail.');
  return value as Record<string, unknown>;
};

async function meId(): Promise<number> {
  const row = unwrap<{ id: number }>(await supabase.from('profiles').select('id').single());
  return row.id;
}

async function myEmail(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  return data.user?.email ?? '';
}

/* --------------------------------------------------------------------- me */

/** Full, private view of the signed-in member. Only ever returned to them. */
export async function getMe(): Promise<Me> {
  requireConfig();
  const id = await meId();
  const [profileRes, photosRes, prefsRes, privacyRes, notifRes, poseRes, deepRes, email] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', id).single(),
    supabase.from('photos').select('id, url').eq('user_id', id).order('position').order('id'),
    supabase.from('preferences').select('*').eq('user_id', id).single(),
    supabase.from('privacy').select('*').eq('user_id', id).single(),
    supabase.from('notification_settings').select('*').eq('user_id', id).single(),
    supabase
      .from('verification_requests')
      .select('pose')
      .eq('user_id', id)
      .eq('status', 'pending')
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('crushes')
      // `crushes` is keyed on the pair, not on a row id: asking for `id` made
      // Postgres answer 42703 and took the whole of `getMe` down with it, which
      // is how a member ended up with no name, no photos and no audience on
      // every screen that reads `me`.
      .select('from_id', { count: 'exact', head: true })
      .eq('from_id', id)
      .eq('deep', true)
      .gt('created_at', Date.now() - 24 * 60 * 60 * 1000),
    myEmail(),
  ]);

  const p = unwrap(profileRes) as Record<string, any>;
  const photos = (unwrap(photosRes) ?? []) as { id: number; url: string }[];
  const prefs = unwrap(prefsRes) as Record<string, any>;
  const privacy = unwrap(privacyRes) as Record<string, any>;
  const notif = unwrap(notifRes) as Record<string, any>;
  const pose = poseRes.error ? null : (poseRes.data as { pose: string } | null);
  const deepUsed = deepRes.count ?? 0;

  return {
    id: p.id as number,
    email: email || (p.email as string),
    status: p.status,
    createdAt: p.created_at,
    onboarded: !!p.onboarded,
    profile: {
      name: p.name,
      username: p.username ?? '',
      birthdate: p.birthdate,
      age: ageFromBirthdate(p.birthdate),
      pronouns: p.pronouns,
      bio: p.bio,
      city: p.city,
      hasLocation: p.lat != null,
      intentions: p.intentions ?? [],
      interests: p.interests ?? [],
      languages: p.languages ?? [],
      relationshipIntention: p.relationship_intention,
      lifestyle: p.lifestyle ?? {},
      photos,
    },
    verification: { status: p.verification, pose: pose?.pose ?? null },
    completion: profileCompletion(p as any, photos.length),
    preferences: {
      ageMin: prefs.age_min,
      ageMax: prefs.age_max,
      maxDistance: prefs.max_distance,
      intentions: prefs.intentions ?? [],
      interests: prefs.interests ?? [],
      verifiedOnly: !!prefs.verified_only,
    },
    privacy: {
      showDistance: !!privacy.show_distance,
      showOnline: !!privacy.show_online,
      showActivity: privacy.show_activity !== false,
      readReceipts: !!privacy.read_receipts,
      discoverable: !!privacy.discoverable,
      profileVisibility: privacy.profile_visibility,
      whoCanMessage: privacy.who_can_message,
      whoCanCrush: privacy.who_can_crush,
      showAge: !!privacy.show_age,
      showCity: !!privacy.show_city,
      incognito: !!privacy.incognito,
    },
    notifications: {
      messages: !!notif.messages,
      crushes: !!notif.crushes,
      moments: !!notif.moments,
      recommendations: !!notif.recommendations,
    },
    // Holup Plus isn't for sale yet — entitlements are wired so features can light up later.
    plus: {
      active: false,
      interested: !!p.plus_interest,
      deepCrushesLeft: Math.max(0, FREE_DEEP_CRUSHES_PER_DAY - deepUsed),
      deepCrushesPerDay: FREE_DEEP_CRUSHES_PER_DAY,
    },
  };
}

/** Partial profile update. Fields omitted from the patch are left untouched. */
export async function updateProfile(patch: Record<string, unknown>): Promise<Me> {
  const id = await meId();
  const next: Record<string, unknown> = { updated_at: Date.now() };
  if ('name' in patch) next.name = str(patch.name, 'Name', { required: true, max: 30 });
  if ('birthdate' in patch) {
    const birthdate = str(patch.birthdate, 'Birthday', { required: true, max: 10 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) throw new ApiError(400, 'Please check your birthday.');
    const age = ageFromBirthdate(birthdate);
    if (age != null && !isMemberAgeEligible(age)) throw new ApiError(400, `Holup is for people aged ${MINIMUM_MEMBER_AGE} and over.`);
    if (age != null && age > 99) throw new ApiError(400, 'Please check your birthday.');
    next.birthdate = birthdate;
  }
  if ('pronouns' in patch) next.pronouns = str(patch.pronouns, 'Pronouns', { max: 24 });
  if ('bio' in patch) next.bio = str(patch.bio, 'Bio', { max: 500 });
  if ('city' in patch) next.city = str(patch.city, 'City', { max: 60 });
  if ('intentions' in patch)
    next.intentions = cleanList(patch.intentions, 'Intentions', INTENTIONS, 6);
  if ('interests' in patch)
    next.interests = cleanList(patch.interests, 'Interests', INTERESTS, 10);
  if ('languages' in patch)
    next.languages = cleanList(patch.languages, 'Languages', LANGUAGES, 6);
  if ('relationshipIntention' in patch) {
    const v = patch.relationshipIntention ? oneOf(patch.relationshipIntention, 'Relationship intention', RELATIONSHIP_INTENTIONS) : '';
    next.relationship_intention = v;
  }
  if ('lifestyle' in patch) next.lifestyle = cleanJson(patch.lifestyle);
  if ('location' in patch) {
    if (patch.location === null) {
      next.lat = null;
      next.lng = null;
    } else {
      const loc = patch.location as { lat?: unknown; lng?: unknown };
      const lat = snapCoordinate(loc.lat);
      const lng = snapCoordinate(loc.lng);
      if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        throw new ApiError(400, 'We couldn’t read that location.');
      }
      next.lat = lat;
      next.lng = lng;
    }
  }
  unwrap(await supabase.from('profiles').update(next).eq('id', id));
  return getMe();
}

export async function completeOnboarding(): Promise<Me> {
  const id = await meId();
  const p = unwrap(await supabase.from('profiles').select('name, birthdate, onboarded').eq('id', id).single()) as Record<string, any>;
  const { count: photoCount } = await supabase.from('photos').select('id', { count: 'exact', head: true }).eq('user_id', id);
  const missing: string[] = [];
  if (!p.name) missing.push('your name');
  if (!p.birthdate) missing.push('your birthday');
  if (!photoCount) missing.push('at least one photo');
  if (missing.length) throw new ApiError(400, `Almost there — add ${missing.join(', ')} to continue.`);
  unwrap(await supabase.from('profiles').update({ onboarded: true, updated_at: Date.now() }).eq('id', id));
  return getMe();
}

export type AddUpListVisibility = 'everyone' | 'close' | 'private';
/**
 * The relationship contract this build talks to.
 *
 * `v2` is the coordinated Add Ups / Homies / Whispers backend. `legacy` is the
 * deployed one — crushes, keeps and connections — and every value below is then
 * read from it rather than invented. The client never shows a count or a button
 * it cannot back, and it never claims consent it did not get.
 */
export type RelationshipBackend = 'v2' | 'legacy';
export type SpaceRelationshipStats = {
  addUps: number;
  /** Null when the deployed backend cannot answer honestly; the chip is hidden. */
  addedUp: number | null;
  keptClose: number;
  postLikes: number;
  canViewAddUps: boolean;
  canViewAddedUp: boolean;
  canViewKeptClose: boolean;
  addUpVisibility: AddUpListVisibility | null;
  outgoingVisibility: AddUpListVisibility | null;
  /** Always false: an Add Up needs nobody's approval. Kept for older servers. */
  approvalRequired: boolean | null;
  myStatus: 'active' | 'pending' | null;
  backend: RelationshipBackend;
};

let detected: RelationshipBackend | null = null;
/**
 * Only a genuinely absent routine counts. A 404 raised *by* an existing routine
 * ("Space not available", "This list is private") must not be mistaken for one,
 * or the client would silently downgrade itself while the v2 backend is live.
 */
const missingFunction = (e: unknown) => e instanceof ApiError && isMissingFunctionError(e);

/**
 * Ask the database which relationship contract it speaks, once per session.
 *
 * A missing function is the signal: production today answers PGRST202 for the
 * v2 routines, so this build falls back to crushes/keeps/connections instead of
 * painting "Retry" over a Space. Probing a real routine means a deploy of the
 * v2 backend switches this over with no client change.
 */
let probing: Promise<RelationshipBackend> | null = null;

export async function relationshipBackend(): Promise<RelationshipBackend> {
  if (detected) return detected;
  // Two surfaces mounting together both used to ask, so the probe went out
  // twice and left two refusals in the network log. The in-flight promise is
  // shared, so a session probes once whichever screen gets there first.
  if (!probing) {
    probing = (async () => {
      try {
        /**
         * The probe used to be `holup_follow_status(0)` — a real routine with a
         * deliberately impossible target, which is how it produced a red 400 on
         * every page load. That was noise nobody could act on, and it made an
         * ordinary Space look broken to anyone reading the console.
         *
         * This asks a v2-only routine that needs nothing from anybody else: my
         * own Homie inbox. A signed-in member always gets 200 from it, so the
         * only way to fail here is the function not existing, which is exactly
         * the question being asked.
         */
        await supabase.rpc('holup_homie_requests_inbox', { p_offset: 0, p_limit: 1 });
        detected = 'v2';
      } catch (e) {
        detected = backendFromProbe({ missing: missingFunction(e) });
      }
      return detected;
    })();
  }
  return probing;
}
/** Reset the cached probe — only the tests need this. */
export function resetRelationshipBackend() { detected = null; probing = null; }

/** My own outgoing crush row is readable (RLS: from_id = me), and is the legacy status. */
async function legacyCrushStatus(id: number): Promise<'active' | 'pending' | null> {
  const me = await meId();
  const { data } = await supabase.from('crushes').select('status').eq('from_id', me).eq('to_id', id).maybeSingle();
  const status = (data as { status?: string } | null)?.status;
  return status === 'accepted' ? 'active' : status === 'pending' ? 'pending' : null;
}

/**
 * Whether the pair is already connected on the deployed backend.
 *
 * `is_connected_pair` looks like the obvious way to ask, but the deployed
 * database never granted it to signed-in members — calling it answers
 * `42501 permission denied`, which is what keeps painting "Retry" on a Space.
 * The `connections` row is readable by either party at the row level
 * (`connections_pair`), so the client asks for the row itself instead.
 */
async function legacyConnectedPair(id: number): Promise<boolean> {
  const me = await meId();
  const { data, error } = await supabase
    .from('connections')
    .select('user_a')
    .or(`user_a.eq.${me},user_b.eq.${me}`)
    .or(`user_a.eq.${id},user_b.eq.${id}`)
    .limit(1);
  if (error) throw toApiError(error);
  return (data?.length ?? 0) > 0;
}

/**
 * The deployed Add Up: `crush_member`. It answers `request`, not a boolean —
 * `connected` when a connection already existed, `accepted` when this tap
 * answered the other person's waiting Add Up, `pending` when they must answer.
 * Reading a field that isn't there would turn every answered Add Up into a
 * pending one, so the mapping lives here in one place.
 */
async function legacyAddUp(id: number): Promise<{ status: 'accepted' | 'pending'; changed: boolean }> {
  const result = await rpc<{ request?: string; isNew?: boolean; mutual?: boolean }>('crush_member', { p_target_id: id });
  const accepted = result?.mutual === true || result?.request === 'accepted' || result?.request === 'connected';
  return { status: accepted ? 'accepted' : 'pending', changed: result?.isNew !== false };
}

export async function spaceRelationshipStats(id: number): Promise<SpaceRelationshipStats> {
  if (await relationshipBackend() === 'v2') {
    const stats = await rpc<Omit<SpaceRelationshipStats, 'backend'>>('holup_follow_stats', { p_target: id });
    return { ...stats, addedUp: stats.addedUp ?? 0, backend: 'v2' };
  }
  // Legacy: the deployed RPC already counts crushes and accepted Close Ones.
  // It has no outgoing count, so `addedUp` stays null and the chip is hidden
  // rather than shown as a zero that would be a lie.
  const base = await rpc<{
    addUps: number; keptClose: number; postLikes: number;
    canViewAddUps: boolean; canViewKeptClose: boolean; addUpVisibility: AddUpListVisibility | null;
  }>('space_relationship_stats', { p_target_id: id });
  const me = await meId();
  return {
    addUps: base.addUps,
    addedUp: null,
    keptClose: base.keptClose,
    postLikes: base.postLikes,
    canViewAddUps: base.canViewAddUps,
    canViewAddedUp: false,
    canViewKeptClose: base.canViewKeptClose,
    addUpVisibility: me === id ? base.addUpVisibility : null,
    outgoingVisibility: null,
    approvalRequired: null,
    myStatus: me === id ? null : await legacyCrushStatus(id),
    backend: 'legacy',
  };
}

export async function spaceRelationshipPeople(id: number, kind: 'addUps' | 'addedUp' | 'keptClose', offset = 0): Promise<{ items: Profile[]; hasMore: boolean }> {
  if (await relationshipBackend() === 'v2') {
    if (kind === 'keptClose') return homiePeople(id, offset);
    const page = await rpc<{ items: Profile[]; hasMore: boolean }>('holup_follow_people', { p_target: id, p_kind: kind, p_offset: offset, p_limit: 40 });
    return { ...page, items: (page.items ?? []).map(profileShape) };
  }
  // Legacy lists exist for exactly the two chips that are shown in legacy mode.
  if (kind === 'addedUp') return { items: [], hasMore: false };
  const page = await rpc<{ items: Profile[]; hasMore: boolean }>('space_relationship_people', { p_target_id: id, p_kind: kind, p_offset: offset, p_limit: 40 });
  return { ...page, items: (page.items ?? []).map(profileShape) };
}

export type HomieStatus = { homies: boolean; incomingPending: boolean; outgoingPending: boolean };

export const homieStatus = async (id: number): Promise<HomieStatus> => {
  if (await relationshipBackend() === 'v2') return rpc<HomieStatus>('holup_homie_status', { p_target: id });
  // Legacy: an accepted Close One is a connection; a waiting crush is a request.
  const me = await meId();
  const connected = await legacyConnectedPair(id);
  const { data: theirs } = await supabase.from('crushes').select('status').eq('from_id', id).eq('to_id', me).maybeSingle();
  const { data: mine } = await supabase.from('crushes').select('status').eq('from_id', me).eq('to_id', id).maybeSingle();
  const statusOf = (row: unknown) => (row as { status?: string } | null)?.status ?? null;
  return {
    homies: connected,
    incomingPending: !connected && statusOf(theirs) === 'pending',
    outgoingPending: !connected && statusOf(mine) === 'pending',
  };
};

export async function requestHomie(id: number): Promise<{ status: 'accepted' | 'pending'; changed: boolean }> {
  if (await relationshipBackend() === 'v2') return rpc('holup_request_homie', { p_target: id });
  return legacyAddUp(id);
}

export async function withdrawHomie(id: number): Promise<boolean> {
  if (await relationshipBackend() === 'v2') return rpc('holup_withdraw_homie', { p_target: id });
  await rpc('cancel_connection_request', { p_to_id: id });
  return true;
}

export async function respondHomie(id: number, accept: boolean): Promise<{ status: 'accepted' | 'declined' }> {
  if (await relationshipBackend() === 'v2') return rpc('holup_respond_homie', { p_sender: id, p_accept: accept });
  if (accept) { await rpc('accept_connection_request', { p_from_id: id }); return { status: 'accepted' }; }
  await rpc('decline_connection_request', { p_from_id: id });
  return { status: 'declined' };
}

export async function homieStats(id: number): Promise<{ count: number; canView: boolean }> {
  if (await relationshipBackend() === 'v2') return rpc('holup_homie_stats', { p_target: id });
  const stats = await spaceRelationshipStats(id);
  return { count: stats.keptClose, canView: stats.canViewKeptClose };
}

export async function homiePeople(id: number, offset = 0): Promise<{ items: Profile[]; hasMore: boolean }> {
  if (await relationshipBackend() === 'v2') {
    const page = await rpc<{ items: Profile[]; hasMore: boolean }>('holup_homie_people', { p_target: id, p_offset: offset, p_limit: 40 });
    return { ...page, items: (page.items ?? []).map(profileShape) };
  }
  const page = await rpc<{ items: Profile[]; hasMore: boolean }>('space_relationship_people', { p_target_id: id, p_kind: 'keptClose', p_offset: offset, p_limit: 40 });
  return { ...page, items: (page.items ?? []).map(profileShape) };
}

export async function homieRequests(offset = 0): Promise<{ items: Profile[]; hasMore: boolean }> {
  if (await relationshipBackend() === 'v2') {
    const page = await rpc<{ items: Profile[]; hasMore: boolean }>('holup_homie_requests_inbox', { p_offset: offset, p_limit: 40 });
    return { ...page, items: (page.items ?? []).map(profileShape) };
  }
  // Legacy has no Homie inbox; nobody is told there is one.
  return { items: [], hasMore: false };
}

/**
 * A directional Add Up, plus whether the pair is already connected. A connected
 * pair has nothing left to Add Up — the Space offers "Remove connection"
 * instead — so the caller can hide the button rather than offer an action the
 * deployed backend refuses with `400 already connected`.
 */
export type FollowStatus = { status: 'active' | 'pending' | null; connected?: boolean };

export async function followStatus(id: number): Promise<FollowStatus> {
  if (await relationshipBackend() === 'v2') return rpc<FollowStatus>('holup_follow_status', { p_target: id });
  const [status, connected] = await Promise.all([legacyCrushStatus(id), legacyConnectedPair(id)]);
  return { status, connected };
}

export async function followMember(id: number): Promise<{ status: 'active' | 'pending'; changed: boolean }> {
  if (await relationshipBackend() === 'v2') return rpc('holup_follow', { p_target: id });
  const { status, changed } = await legacyAddUp(id);
  return { status: status === 'accepted' ? 'active' : 'pending', changed };
}

export async function unfollowMember(id: number): Promise<void> {
  if (await relationshipBackend() === 'v2') { await rpc('holup_unfollow', { p_target: id }); return; }
  await rpc('uncrush_member', { p_target_id: id });
}

/**
 * Add Ups never need approval, so `approvalRequired` is only kept for the RPC's
 * two-argument signature. Passing it does nothing and cannot turn a rule back on;
 * what this actually sets now is who may see the list.
 */
export async function setFollowSettings(approvalRequired: boolean | null, visibility: AddUpListVisibility | null): Promise<void> {
  if (await relationshipBackend() === 'v2') {
    await rpc('holup_set_follow_settings', { p_approval: approvalRequired, p_outgoing_visibility: visibility });
    return;
  }
  // Neither setting exists on the deployed backend; say so instead of pretending.
  throw new ApiError(501, 'Add Up approval and Added Up privacy arrive with the next release.');
}

export async function pendingFollowRequests(offset = 0): Promise<{ items: Profile[]; hasMore: boolean }> {
  if (await relationshipBackend() === 'v2') {
    const page = await rpc<{ items: Profile[]; hasMore: boolean }>('holup_pending_follow_requests', { p_offset: offset, p_limit: 40 });
    return { ...page, items: (page.items ?? []).map(profileShape) };
  }
  return { items: [], hasMore: false };
}

export async function respondToFollow(id: number, accept: boolean): Promise<void> {
  if (await relationshipBackend() === 'v2') { await rpc('holup_respond_follow', { p_follower: id, p_accept: accept }); return; }
  await (accept ? rpc('accept_connection_request', { p_from_id: id }) : rpc('decline_connection_request', { p_from_id: id }));
}

export async function setAddUpListVisibility(visibility: AddUpListVisibility): Promise<void> {
  await rpc('set_add_up_list_visibility', { p_visibility: visibility });
}

/** Only ask for a banner on a Space, not on every app launch. */
export async function spaceBanner(id: number): Promise<string | null> {
  const banner = await rpc<unknown>('space_banner', { p_target_id: id });
  return typeof banner === 'string' ? banner : null;
}

/** A Space banner is stored separately and never consumes a profile-photo slot. */
export async function setSpaceBanner(picked: { uri: string; mimeType?: string } | null): Promise<string | null> {
  let next: string | null = null;
  if (picked) {
    const id = await meId();
    const type = picked.mimeType || 'image/jpeg';
    next = await uploadMediaFile('media', `banners/${id}/banner.${extensionFor(type)}`, picked.uri, type);
  }
  let old: string | null;
  try {
    old = await rpc<string | null>('set_space_banner', { p_url: next });
  } catch (e) {
    if (next) await removeMediaFile(next);
    throw e;
  }
  if (old && old !== next) await removeMediaFile(old);
  return next;
}

export async function uploadPhoto(uri: string, mimeType?: string): Promise<Me> {
  const id = await meId();
  const { count: photoCount } = await supabase
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', id);
  if ((photoCount ?? 0) >= MAX_PHOTOS) throw new ApiError(400, `You can show up to ${MAX_PHOTOS} photos.`);
  const type = mimeType || 'image/jpeg';
  const path = await uploadMediaFile('media', `photos/${id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extensionFor(type)}`, uri, type);
  unwrap(await supabase.from('photos').insert({ user_id: id, url: path, position: photoCount ?? 0 }));
  return getMe();
}

export async function deletePhoto(photoId: number): Promise<Me> {
  const id = await meId();
  const photo = unwrap(
    await supabase.from('photos').select('id, url').eq('id', photoId).eq('user_id', id).single(),
  ) as { id: number; url: string };
  const profile = unwrap(await supabase.from('profiles').select('onboarded').eq('id', id).single()) as { onboarded: boolean };
  const { count } = await supabase.from('photos').select('id', { count: 'exact', head: true }).eq('user_id', id);
  if (profile.onboarded && (count ?? 0) <= 1) throw new ApiError(400, 'Keep at least one photo on your Space.');
  unwrap(await supabase.from('photos').delete().eq('id', photo.id));
  await removeMediaFile(photo.url);
  return getMe();
}

export async function reorderPhotos(ids: number[]): Promise<Me> {
  const id = await meId();
  for (let i = 0; i < ids.length; i += 1) {
    unwrap(await supabase.from('photos').update({ position: i }).eq('id', ids[i]).eq('user_id', id));
  }
  return getMe();
}

export async function updatePreferences(prefs: Preferences): Promise<Me> {
  const id = await meId();
  const ageMin = clampMemberAge(prefs.ageMin);
  const ageMax = clampMemberAge(prefs.ageMax);
  if (ageMin > ageMax) throw new ApiError(400, 'Your age range is upside down.');
  unwrap(
    await supabase
      .from('preferences')
      .update({
        age_min: ageMin,
        age_max: ageMax,
        max_distance: Math.min(500, Math.max(0, Math.round(prefs.maxDistance))),
        intentions: cleanList(prefs.intentions, 'Intentions', INTENTIONS, 6),
        interests: cleanList(prefs.interests, 'Interests', INTERESTS, 24),
        verified_only: !!prefs.verifiedOnly,
      })
      .eq('user_id', id),
  );
  return getMe();
}

const PRIVACY_FIELDS: Record<string, [string, 'bool' | readonly string[]]> = {
  showDistance: ['show_distance', 'bool'],
  showOnline: ['show_online', 'bool'],
  showActivity: ['show_activity', 'bool'],
  readReceipts: ['read_receipts', 'bool'],
  discoverable: ['discoverable', 'bool'],
  showAge: ['show_age', 'bool'],
  showCity: ['show_city', 'bool'],
  profileVisibility: ['profile_visibility', ['everyone', 'connections']],
  whoCanMessage: ['who_can_message', ['everyone', 'crushes', 'mutual']],
  whoCanCrush: ['who_can_crush', ['everyone', 'verified']],
};

/**
 * Usernames are the one identity rule the database owns, so the check and the
 * change both go through it — the client never decides what a valid handle is.
 */
/* ------------------------------------------------------------------- flow */

export async function flowFeed(limit = 20, after?: number | null): Promise<FlowPage> {
  const page = await rpc<FlowPage>('flow_feed', { p_limit: limit, p_after: after ?? null });
  return { items: page?.items ?? [] };
}

/**
 * The ranked Flow.
 *
 * `flow_feed` is a timeline; this is the scored stream that replaces it on the
 * home screen: engagement velocity, recency, affinity and an exploration boost,
 * with the reason attached to every item. The cursor is opaque — round-trip it.
 */
export async function rankedFlow(limit = 8, cursor: FlowCursor | null = null): Promise<RankedFlowPage> {
  try {
    const page = await rpc<RankedFlowPage>('flow_ranked_feed', { p_limit: limit, p_cursor: cursor });
    return {
      items: page?.items ?? [],
      nextCursor: page?.nextCursor ?? null,
      ranking: page?.ranking,
    };
  } catch (e) {
    /**
     * The ranked feed is a new database function, and an app can reach a phone
     * before the migration that creates it has been applied. That must degrade to
     * the timeline the app already had, not to an error screen over the whole
     * feed — so a missing function is caught here and the old `flow_feed` answers
     * instead. Anything else (a real permission or network fault) still throws.
     */
    if (!isMissingFunction(e)) throw e;
    const page = await flowFeed(limit, cursor?.id ?? null);
    const items = page.items;
    return {
      items,
      nextCursor: items.length ? { score: 0, id: items[items.length - 1].id } : null,
    };
  }
}

/** PostgREST says PGRST202; Postgres itself says 42883. Either means "no such function". */
function isMissingFunction(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false;
  const text = `${e.code ?? ''} ${e.message ?? ''}`;
  return /PGRST202|42883|Could not find the function|does not exist/i.test(text);
}

/**
 * Report how long a post was in front of the reader. Fire-and-forget: the feed
 * must never wait on its own telemetry, and a dropped signal is worth less than
 * a stutter. `record_post_view` throttles itself server-side.
 */
export async function recordPostView(
  postId: number,
  dwellMs: number,
  completed: boolean,
  position: number | null,
): Promise<{ recorded: boolean; reason?: string }> {
  return rpc('record_post_view', {
    p_post_id: postId,
    p_dwell_ms: Math.round(dwellMs),
    p_completed: completed,
    p_position: position,
  });
}

export type AppSettings = { callsEnabled: boolean; publicSharingEnabled: boolean; announcement: { title: string; body: string } | null };
export type AdminState = { features: { calls: boolean; public_post_sharing: boolean }; announcement: { title: string; body: string; active: boolean } };
export const isHolupAdmin = () => rpc<boolean>('holup_is_admin');
export const appSettings = () => rpc<AppSettings>('holup_app_settings');
export const adminState = () => rpc<AdminState>('holup_admin_state');
export type AdminAnalytics = { members: number; seenLast7Days: number; newMembersLast7Days: number; postsLast7Days: number; reactionsLast7Days: number; commentsLast7Days: number; whispersLast7Days: number; openReports: number };
export const adminAnalytics = () => rpc<AdminAnalytics>('holup_admin_analytics');
export const adminSetFeature = (key: 'calls' | 'public_post_sharing', enabled: boolean) => rpc<boolean>('holup_admin_set_feature', { p_key: key, p_enabled: enabled });
export const adminSetAnnouncement = (title: string, body: string, active: boolean) => rpc<boolean>('holup_admin_announcement', { p_title: title, p_body: body, p_active: active });

export type AdminReport = { id: number; reporterId: number; reporterName: string | null; reportedId: number; reportedName: string | null; reason: string; details: string; context: string; handled: boolean; createdAt: number };
export type AdminAccount = { id: number; name: string; username: string | null; status: string; onboarded: boolean; verification: string };
export type AdminAuditEvent = { id: number; actor: string; kind: string; details: Record<string, unknown>; createdAt: number };
export const adminReports = (handled = false, offset = 0) => rpc<AdminReport[]>('holup_admin_reports', { p_handled: handled, p_limit: 51, p_offset: offset });
export const adminSetReportHandled = (id: number, handled: boolean) => rpc<boolean>('holup_admin_set_report_handled', { p_report_id: id, p_handled: handled });
export const adminAccounts = (query: string) => rpc<AdminAccount[]>('holup_admin_accounts', { p_query: query });
export const adminAudit = () => rpc<AdminAuditEvent[]>('holup_admin_audit');

/** Check that an external link has a public landing at the time it is made. */
export async function publicPostPreview(postId: number): Promise<{ id: number; body: string; author: string } | null> {
  return rpc('public_post_preview', { p_post_id: postId });
}

/** Owner-only lists; the database, not the client, authorizes the request. */
export async function viewerPage(kind: 'post' | 'moment', id: number, offset: number): Promise<ViewerPage> {
  return rpc<ViewerPage>(kind === 'post' ? 'post_viewers' : 'moment_viewers', {
    [kind === 'post' ? 'p_post_id' : 'p_moment_id']: id,
    p_limit: 100,
    p_offset: offset,
  });
}

/** A deliberate act — like, comment, save, share, or "not interested". */
export async function recordPostFeedback(
  postId: number,
  kind: 'like' | 'comment' | 'save' | 'share' | 'hide',
): Promise<{ recorded: boolean; kind?: string }> {
  return rpc('record_post_feedback', { p_post_id: postId, p_kind: kind });
}

/**
 * Crushes: the posts of the people you have a Crush with, newest first.
 *
 * Crushes is a feed, not a directory — `crush_posts_feed` returns the same post
 * shape everything else returns, minus clips, because clips are Flow's. It
 * carries `saved` through `post_engagement`, which is what makes Pick and Crush
 * work here without any second code path.
 */
export async function crushesFeed(limit = 20, after?: number | null): Promise<FlowPage> {
  const page = await rpc<FlowPage>('crush_posts_feed', { p_limit: limit, p_after: after ?? null });
  /* The cursor travels with the page. Rebuilding the object without it is how
     this feed stayed exactly one page long while looking paged: `hasNextPage`
     was never true, so nothing ever asked for the second page. */
  return { items: page?.items ?? [], nextCursor: page?.nextCursor ?? null };
}

/**
 * The saved drawer: the posts you kept, newest save first, in the same shape as
 * the Flow. `saved_posts` applies `can_view_post` before returning a row, so a
 * post you can no longer see drops out of the list instead of sitting in it as
 * a dead tap.
 */
export async function savedPosts(limit = 20, after?: number | null): Promise<FlowPage> {
  const page = await rpc<FlowPage>('saved_posts', { p_limit: limit, p_after: after ?? null });
  return { items: page?.items ?? [] };
}

/** Shares a post. Photos and clips go to the object store like any other media. */
export async function createPost(input: {
  body: string;
  audience: 'connections' | 'everyone';
  photoUri?: string | null;
  photoMime?: string | null;
  videoUri?: string | null;
  videoMime?: string | null;
  edit?: LiveEdit | null;
  commentsEnabled?: boolean;
  location?: string | null;
  /** When set, the post belongs to that Circle and its audience is the Circle. */
  circleId?: number | null;
}): Promise<Post> {
  const body = str(input.body, 'Post', { max: 500 });
  let media: string | null = null;
  if (input.photoUri) {
    const id = await meId();
    const type = input.photoMime || 'image/jpeg';
    media = await uploadMediaFile('media', `posts/${id}/${Date.now()}.${extensionFor(type)}`, input.photoUri, type);
  }
  if (input.videoUri) {
    const id = await meId();
    const type = (input.videoMime || 'video/mp4').toLowerCase();
    // extensionFor() maps mp4 to m4a, which is right for a voice note and wrong
    // for a clip, so the container is chosen here instead.
    media = await uploadMediaFile(
      'media',
      `posts/${id}/${Date.now()}.${type.includes('webm') ? 'webm' : 'mp4'}`,
      input.videoUri,
      type,
    );
  }
  const args = {
    p_body: body,
    p_media_url: media,
    p_audience: input.audience === 'everyone' ? 'everyone' : 'connections',
    p_circle_id: input.circleId ?? null,
  };
  // Legacy callers retain the old RPC; the composer uses an atomic RPC when it
  // offers the choice, so comments are never enabled for a newly closed post.
  if (input.commentsEnabled !== undefined) {
    return rpc<Post>('create_post_with_location', {
      ...args, p_edit: input.edit ?? null, p_comments_enabled: input.commentsEnabled, p_location: input.location?.trim() || null,
    });
  }
  return rpc<Post>('create_post', {
    ...args, ...(input.edit ? { p_edit: input.edit as unknown as Record<string, unknown> } : {}),
  });
}

/** A viewer may read this only if the server says the post is visible. */
export async function postCommentsEnabled(postId: number): Promise<boolean> {
  return rpc<boolean>('post_comment_settings', { p_post_id: postId });
}

/**
 * The clips rail on Discover: the week's most-Crushed clips, one per author,
 * already filtered to what this member may see. `mediaKind` is always `video`.
 */
export async function trendingClips(limit = 12): Promise<Post[]> {
  return (await rpc<Post[]>('trending_clips', { p_limit: limit })) ?? [];
}

export async function deletePost(postId: number): Promise<void> {
  await rpc<boolean>('delete_post', { p_post_id: postId });
}

/**
 * Liking is one-way news: the author hears about the first reaction and not
 * about anybody changing their mind afterwards.
 *
 * A reaction carries what it is — crush, fire, laugh, wow, clap — so a post
 * answers the same way a Moment already did. `liked: false` withdraws it, and
 * the kind is ignored in that case.
 */
export async function reactToPost(
  postId: number,
  liked = true,
  kind: ReactionKind = 'crush',
): Promise<{
  liked: boolean;
  likeCount: number;
  myReaction: ReactionKind | null;
  reactionKinds: Partial<Record<ReactionKind, number>>;
}> {
  const r = await rpc<{
    liked: boolean;
    likeCount: number;
    myReaction: ReactionKind | null;
    reactionKinds: Partial<Record<ReactionKind, number>>;
  }>('react_to_post', {
    p_post_id: postId,
    p_liked: liked,
    p_kind: kind,
  });
  return {
    liked: r?.liked ?? liked,
    likeCount: r?.likeCount ?? 0,
    myReaction: r?.myReaction ?? (liked ? kind : null),
    reactionKinds: r?.reactionKinds ?? {},
  };
}

/** Keep a post for later, or let it go. Silent either way — the author is not told. */
export async function savePost(postId: number, saved = true): Promise<{ saved: boolean }> {
  const r = await rpc<{ saved: boolean }>('save_post', { p_post_id: postId, p_saved: saved });
  return { saved: r?.saved ?? saved };
}

/** Say you liked a comment — the table existed, nothing wrote to it. */
export async function likePostComment(
  commentId: number,
  liked = true,
): Promise<{ liked: boolean; likeCount: number }> {
  const r = await rpc<{ liked: boolean; likeCount: number }>('like_post_comment', {
    p_comment_id: commentId,
    p_liked: liked,
  });
  return { liked: r?.liked ?? liked, likeCount: r?.likeCount ?? 0 };
}

/** One post by id, enforcing the same audience and block rules as the Feed. */
export async function loadPost(postId: number): Promise<Post> {
  return rpc<Post>('load_post', { p_post_id: postId });
}

/**
 * The people who reacted to a post.
 *
 * The sheet over a post has two tabs — what was said, and who felt something —
 * and until this existed there was no way to answer the second one from the
 * client: the count was in `post_engagement`, the names were not.
 */
/**
 * A sound, and the clips on it.
 *
 * `sound_page` decides visibility with the same `can_view_post` rule the feeds
 * use, so a clip you could not see in the feed cannot be reached through the
 * sound it happens to sit on.
 */
export async function soundPage(soundId: number, limit = 24): Promise<SoundPage> {
  return rpc<SoundPage>('sound_page', { p_sound_id: soundId, p_limit: limit });
}

/** Put somebody else's sound on a clip of your own. */
export async function attachPostSound(postId: number, soundId: number): Promise<unknown> {
  return rpc('attach_post_sound', { p_post_id: postId, p_sound_id: soundId });
}

export async function postLikers(postId: number, limit = 40): Promise<PostLiker[]> {
  const res = await rpc<{ items: PostLiker[] }>('post_likers', { p_post_id: postId, p_limit: limit });
  return res?.items ?? [];
}

export async function postComments(postId: number, limit = 50): Promise<{ items: PostComment[] }> {
  const page = await rpc<{ items: PostComment[] }>('post_comments_feed', { p_post_id: postId, p_limit: limit });
  return { items: page?.items ?? [] };
}

export async function commentOnPost(
  postId: number,
  body: string,
  parentId: number | null = null,
): Promise<PostComment> {
  return rpc<PostComment>('comment_on_post', {
    p_post_id: postId,
    p_body: str(body, 'Comment', { max: 1000 }),
    p_parent_id: parentId,
  });
}

/** Yours to remove, or the post is yours and the comment was left on it. */
export async function deletePostComment(commentId: number): Promise<void> {
  await rpc<boolean>('delete_post_comment', { p_comment_id: commentId });
}

/* ------------------------------------------------------- keep close, circles */

/**
 * Rewrite your own post. Words and audience only — the media is the file you
 * chose, and changing it would be a different post.
 */
export async function editPost(input: {
  postId: number;
  body?: string;
  audience?: 'everyone' | 'connections' | 'private';
}): Promise<Post> {
  return rpc<Post>('edit_post', {
    p_post_id: input.postId,
    p_body: input.body ?? null,
    p_audience: input.audience ?? null,
    p_edit: null,
  });
}

/**
 * Keep Close became an Add Up.
 *
 * On the v2 backend `keep_close` and `let_go` are closed — they return
 * `409 relationship_upgrade_required` — because keeping somebody close *is*
 * following them one way with nobody's permission. The screen is unchanged, so
 * the verb is translated here rather than in every caller: the same button
 * writes `holup_follow`, and the same state comes back in the old shape so the
 * Space's toggle stays in step.
 */
export async function keepState(memberId: number): Promise<KeepState> {
  if (await relationshipBackend() === 'v2') {
    const [status, stats] = await Promise.all([
      rpc<FollowStatus>('holup_follow_status', { p_target: memberId }),
      rpc<{ addUps?: number; addedUp?: number; canViewAddUps?: boolean }>('holup_follow_stats', { p_target: memberId }),
    ]);
    return {
      keeps: status?.status === 'active' || status?.status === 'pending',
      keepsYou: false,
      keepsCount: Number(stats?.addUps ?? 0),
      keptByCount: Number(stats?.addedUp ?? 0),
      self: false,
    };
  }
  return rpc<KeepState>('keep_state', { p_member_id: memberId });
}

/** Keep Close is one-way and silent: they are never told you let go either. */
export async function keepClose(memberId: number): Promise<KeepState> {
  if (await relationshipBackend() === 'v2') {
    await rpc('holup_follow', { p_target: memberId });
    return keepState(memberId);
  }
  return rpc<KeepState>('keep_close', { p_member_id: memberId });
}

export async function letGo(memberId: number): Promise<void> {
  if (await relationshipBackend() === 'v2') {
    await rpc<boolean>('holup_unfollow', { p_target: memberId });
    return;
  }
  await rpc<boolean>('let_go', { p_member_id: memberId });
}

export async function closeOnes(limit = 50): Promise<{ items: CloseOne[] }> {
  const page = await rpc<{ items: CloseOne[] }>('close_ones', { p_limit: limit });
  return { items: page?.items ?? [] };
}

/**
 * What one member has posted.
 *
 * The RPC already existed in the database (`space_posts`) and nothing on the
 * client had ever called it, so a Space could show who somebody is and never
 * what they had made.
 */
export async function spacePosts(authorId: number, limit = 20, after: number | null = null): Promise<{ items: Post[]; nextCursor: number | null }> {
  const page = await rpc<{ items: Post[]; nextCursor?: number | null }>('space_posts', {
    p_author_id: authorId,
    p_limit: limit,
    p_after: after,
  });
  return { items: page?.items ?? [], nextCursor: page?.nextCursor ?? null };
}

/**
 * The highlight in each of your Circles — the post people reacted to, and how
 * busy each room has been. Computed in the database, from rows, never seeded.
 */
export async function circleHighlights(limit = 8): Promise<CircleHighlight[]> {
  return (await rpc<CircleHighlight[]>('circle_highlights', { p_limit: limit })) ?? [];
}

/** Ask to join a public Circle. The owner decides; the database enforces it. */
export async function requestJoinCircle(circleId: number): Promise<{ status: string; requestId: number }> {
  return rpc('request_join_circle', { p_circle_id: circleId });
}

export async function cancelJoinRequest(circleId: number): Promise<boolean> {
  return rpc('cancel_join_request', { p_circle_id: circleId });
}

/** Who is asking to join the Circles you started. */
export async function myCircleRequests(): Promise<CircleJoinRequest[]> {
  return (await rpc<CircleJoinRequest[]>('my_circle_requests')) ?? [];
}

export async function decideCircleRequest(requestId: number, approve: boolean): Promise<{ ok: boolean; approved: boolean; memberId: number; circleId: number }> {
  return rpc('decide_circle_request', { p_request_id: requestId, p_approve: approve });
}

export async function circleRequestState(circleId: number): Promise<{ requested: boolean }> {
  return rpc('circle_request_state', { p_circle_id: circleId });
}

export async function myCircles(): Promise<CircleListPage> {
  const page = await rpc<CircleListPage>('my_circles');
  return { items: page?.items ?? [] };
}

export async function circleSpace(circleId: number): Promise<CircleSpace> {
  return rpc<CircleSpace>('circle_space', { p_circle_id: circleId });
}

export async function createCircle(input: {
  name: string;
  about?: string;
  memberIds?: number[];
}): Promise<CircleSpace> {
  return rpc<CircleSpace>('create_circle', {
    p_name: String(input.name ?? '').trim(),
    p_about: String(input.about ?? '').trim(),
    p_member_ids: input.memberIds ?? [],
  });
}

/** The owner's answer to what kind of room this is, and who may find it. */
export async function setCircleLook(
  circleId: number,
  look: { theme?: string | null; visibility?: 'connections' | 'public' },
): Promise<void> {
  await rpc('set_circle_look', {
    p_circle_id: circleId,
    p_theme: look.theme ?? null,
    p_visibility: look.visibility ?? 'connections',
  });
}

/* ------------------------------------------------ circles: find, ask, invite */

/**
 * Rooms you could walk into.
 *
 * Offset paging with a deterministic order, so "load more" never shows the same
 * room twice. The database decides who is recommendable — a private room, a room
 * you are in, a room whose owner has blocked you, and a full room never appear.
 */
export async function discoverCircles(limit = 6, offset = 0): Promise<DiscoverCircle[]> {
  return (await rpc<DiscoverCircle[]>('discover_circles', { p_limit: limit, p_offset: offset })) ?? [];
}

/** One room from outside: its face, its people, its week — never its contents. */
export async function circlePreview(circleId: number): Promise<CirclePreview> {
  return rpc<CirclePreview>('circle_preview', { p_circle_id: circleId });
}

/**
 * Ask to come in, or come in.
 *
 * One call, because the policy is the database's decision and not the button's:
 * an open room returns `member`, a room with approval returns `pending`, and an
 * invitation with the door already open returns `member` with `viaInvitation`.
 */
export async function joinCircle(
  circleId: number,
): Promise<{ state: CircleStanding; requestId?: number; already?: boolean; viaInvitation?: boolean }> {
  return rpc('join_circle', { p_circle_id: circleId });
}

/** The owner's two switches. Independent on purpose. */
export async function setCircleAccess(
  circleId: number,
  input: { discoverable: boolean; joinPolicy: CircleJoinPolicy },
): Promise<{ id: number; discoverable: boolean; joinPolicy: CircleJoinPolicy }> {
  return rpc('set_circle_access', {
    p_circle_id: circleId,
    p_discoverable: input.discoverable,
    p_join_policy: input.joinPolicy,
  });
}

/** The owner's desk: members, requests, invitations, declines, and the switches. */
export async function circleManage(circleId: number): Promise<CircleManage> {
  return rpc<CircleManage>('circle_manage', { p_circle_id: circleId });
}

/** Ask somebody in. Creates an invitation they have to accept. */
export async function inviteToCircle(
  circleId: number,
  memberId: number,
): Promise<{ state: string; invitationId?: number; fromRequest?: boolean }> {
  return rpc('invite_to_circle', { p_circle_id: circleId, p_member_id: memberId });
}

/** The invitations waiting on you. */
export async function myCircleInvitations(): Promise<CircleInvitation[]> {
  return (await rpc<CircleInvitation[]>('my_circle_invitations')) ?? [];
}

/** Yes or no to one. Accepting is what creates the membership. */
export async function respondCircleInvitation(
  invitationId: number,
  accept: boolean,
): Promise<{ ok: boolean; accepted: boolean; circleId: number }> {
  return rpc('respond_circle_invitation', { p_invitation_id: invitationId, p_accept: accept });
}

/** People the owner could invite — their Connections first. */
export async function circleInviteCandidates(circleId: number, query = ''): Promise<CircleInviteCandidate[]> {
  return (await rpc<CircleInviteCandidate[]>('circle_invite_candidates', {
    p_circle_id: circleId,
    p_query: query,
  })) ?? [];
}

/** The Circles on somebody's Space — public ones, and ones you share. */
export async function memberCircles(memberId: number): Promise<{ items: CircleSummary[]; connected: boolean }> {
  return rpc<{ items: CircleSummary[]; connected: boolean }>('member_circles', { p_member_id: memberId });
}

export async function renameCircle(circleId: number, name: string): Promise<void> {
  await rpc<boolean>('rename_circle', { p_circle_id: circleId, p_name: String(name ?? '').trim() });
}

export async function deleteCircle(circleId: number): Promise<void> {
  await rpc<boolean>('delete_circle', { p_circle_id: circleId });
}

export async function addCircleMember(circleId: number, memberId: number): Promise<void> {
  await rpc<boolean>('add_circle_member', { p_circle_id: circleId, p_member_id: memberId });
}

export async function removeCircleMember(circleId: number, memberId: number): Promise<void> {
  await rpc<boolean>('remove_circle_member', { p_circle_id: circleId, p_member_id: memberId });
}

export async function leaveCircle(circleId: number): Promise<void> {
  await rpc<boolean>('leave_circle', { p_circle_id: circleId });
}

export async function circleFeed(circleId: number, limit = 20, after?: number | null): Promise<FlowPage> {
  const page = await rpc<FlowPage>('circle_feed', { p_circle_id: circleId, p_limit: limit, p_after: after ?? null });
  return { items: page?.items ?? [] };
}

export async function circleMessages(
  circleId: number, limit = 30, before?: number | null,
): Promise<CircleMessagesPage> {
  const page = await rpc<CircleMessagesPage>('circle_messages', {
    p_circle_id: circleId, p_limit: limit, p_before: before ?? null,
  });
  return { items: page?.items ?? [] };
}

/** Sends into a Circle. Photos and voice notes ride the object store. */
export async function sendCircleMessage(input: {
  circleId: number;
  body?: string;
  kind?: CircleMessageKind;
  mediaUri?: string | null;
  mediaMime?: string | null;
  edit?: LiveEdit | null;
}): Promise<CircleMessage> {
  const kind = input.kind ?? 'text';
  let media: string | null = null;
  if (input.mediaUri) {
    const id = await meId();
    const type = (input.mediaMime || 'image/jpeg').toLowerCase();
    // extensionFor() maps mp4 to m4a, which is right for a voice note and wrong
    // for a clip, so the container is chosen here instead.
    const ext = kind === 'video'
      ? (type.includes('webm') ? 'webm' : 'mp4')
      : extensionFor(type);
    media = await uploadMediaFile(
      'media',
      `circles/${id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`,
      input.mediaUri,
      type,
    );
  }
  return rpc<CircleMessage>('send_circle_message', {
    p_circle_id: input.circleId,
    p_body: input.body ?? '',
    p_media_url: media,
    p_kind: kind,
    ...(input.edit ? { p_edit: input.edit as unknown as Record<string, unknown> } : {}),
  });
}

export async function readCircle(circleId: number): Promise<void> {
  await rpc<boolean>('read_circle', { p_circle_id: circleId });
}

export async function usernameAvailable(candidate: string): Promise<boolean> {
  const clean = String(candidate ?? '').trim().toLowerCase();
  if (!clean) return false;
  return (await rpc<boolean>('username_available', { p_username: clean })) === true;
}

export async function setUsername(candidate: string): Promise<string> {
  const clean = String(candidate ?? '').trim().toLowerCase();
  const row = await rpc<{ username: string }>('set_username', { p_username: clean });
  return row.username;
}

export async function profileByUsername(candidate: string): Promise<FullProfile | null> {
  const clean = String(candidate ?? '').trim().toLowerCase().replace(/^@/, '');
  if (!clean) return null;
  return await rpc<FullProfile | null>('profile_by_username', { p_username: clean });
}

export async function updatePrivacy(patch: Partial<Privacy>): Promise<Me> {
  if (patch.incognito) {
    throw new ApiError(
      402,
      'Incognito is part of Holup Plus, which isn’t available yet. Hide your Space from Discover instead — it’s free.',
      'plus_required',
    );
  }
  const id = await meId();
  const next: Record<string, unknown> = {};
  for (const [key, [column, kind]] of Object.entries(PRIVACY_FIELDS)) {
    if (!(key in patch)) continue;
    const value = (patch as Record<string, unknown>)[key];
    next[column] = kind === 'bool' ? !!value : oneOf(value, key, kind as readonly string[]);
  }
  if (Object.keys(next).length) unwrap(await supabase.from('privacy').update(next).eq('user_id', id));
  return getMe();
}

export async function updateNotificationSettings(patch: Partial<NotificationSettings>): Promise<Me> {
  const id = await meId();
  const next: Record<string, unknown> = {};
  for (const key of ['messages', 'crushes', 'moments', 'recommendations']) {
    if (key in patch) next[key] = !!(patch as Record<string, unknown>)[key];
  }
  if (Object.keys(next).length) {
    unwrap(await supabase.from('notification_settings').update(next).eq('user_id', id));
  }
  return getMe();
}

export async function setStatus(status: 'active' | 'paused'): Promise<Me> {
  const id = await meId();
  unwrap(await supabase.from('profiles').update({ status: oneOf(status, 'Status', ['active', 'paused'] as const) }).eq('id', id));
  return getMe();
}

export async function recordPlusInterest(): Promise<Me> {
  const id = await meId();
  unwrap(await supabase.from('profiles').update({ plus_interest: true }).eq('id', id));
  return getMe();
}

/**
 * Verification runs through Didit (hosted ID + liveness + face-match flow).
 * The member app only starts a session and checks the result; the decision
 * arrives via the didit-webhook edge function (or a poll through didit-status).
 * The AI reviewer is an admin-only assist and is never called from here.
 */

/** Invoke an edge function, surfacing the function's own JSON error message. */
async function invokeFunction<T>(name: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await supabase.functions.invoke(name, { body });
  if (res.error) {
    // FunctionsHttpError carries the raw Response in .context — read the
    // function's { error, detail } JSON so members see the real message.
    let message = '';
    let status = 502;
    try {
      const ctx = (res.error as { context?: Response }).context;
      status = ctx?.status ?? 502;
      const body = await ctx?.json();
      if (body && typeof body === 'object') {
        const b = body as { error?: unknown; detail?: unknown; message?: unknown };
        message = String(b.error ?? b.detail ?? b.message ?? '');
      }
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(status, message || (res.error as Error).message);
  }
  return res.data as T;
}

export async function startDiditVerification(newSession = false): Promise<{ url: string; sessionId: string }> {
  const d = await invokeFunction<{ url?: string; session_id?: string; error?: string }>('didit-session', { newSession });
  if (!d?.url) throw new ApiError(502, d?.error || 'Couldn’t start verification — try again.');
  return { url: d.url, sessionId: String(d.session_id ?? '') };
}

export type DiditStatusResponse = {
  status: 'none' | 'pending' | 'verified' | 'rejected';
  diditStatus: string | null;
  sessionId: string | null;
};

export async function getDiditStatus(): Promise<DiditStatusResponse> {
  const d = await invokeFunction<Partial<DiditStatusResponse> & { error?: string }>('didit-status');
  if (!d?.status) throw new ApiError(502, d?.error || 'Couldn’t check the status — try again.');
  return { status: d.status, diditStatus: d.diditStatus ?? null, sessionId: d.sessionId ?? null };
}

export async function updateAccount(body: {
  currentPassword: string;
  email?: string;
  newPassword?: string;
}): Promise<{ me: Me; emailPending: boolean }> {
  const email = await myEmail();
  const check = await supabase.auth.signInWithPassword({ email, password: String(body.currentPassword ?? '') });
  if (check.error) throw new ApiError(403, 'Your current password isn’t right.');
  const update: { email?: string; password?: string } = {};
  if (body.email) {
    const next = str(body.email, 'Email', { required: true, max: 200 }).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(next)) throw new ApiError(400, 'That email doesn’t look right.');
    update.email = next;
  }
  if (body.newPassword) {
    const pw = String(body.newPassword);
    if (pw.length < 8) throw new ApiError(400, 'Use at least 8 characters for your password.');
    update.password = pw;
  }
  if (Object.keys(update).length) {
    const { error } = await supabase.auth.updateUser(update);
    if (error) throw toApiError(error);
  }
  if (update.password) await supabase.auth.signOut({ scope: 'others' }).catch(() => {});
  let emailPending = false;
  if (update.email) {
    // Supabase often requires confirming both addresses before an email change
    // lands (auth keeps the old email and stashes `new_email` until then). Only
    // mirror it into the profile once it's actually in effect — never advertise
    // an unconfirmed address.
    const { data } = await supabase.auth.getUser();
    const user = data.user as { email?: string; new_email?: string | null } | null;
    if (user?.email === update.email && !user?.new_email) {
      const id = await meId();
      unwrap(await supabase.from('profiles').update({ email: update.email }).eq('id', id));
    } else {
      emailPending = true;
    }
  }
  return { me: await getMe(), emailPending };
}

/**
 * Where the app is actually running, or undefined off the web.
 *
 * Every auth email that carries a link needs this: GoTrue builds the link from
 * `site_url` unless the request names a redirect, and `site_url` was still the
 * old Netlify deployment — so the link took members out of the app they were
 * standing in. The origin also has to be in the project's redirect allow list,
 * which is a Supabase-side setting, not something this file can fix.
 */
export function webOrigin(): string | undefined {
  return browserLocation(Platform.OS, typeof window === 'undefined' ? undefined : window)?.origin;
}

export async function resendConfirmation(email: string): Promise<void> {
  const origin = webOrigin();
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: email.trim().toLowerCase(),
    ...(origin ? { options: { emailRedirectTo: origin } } : {}),
  });
  if (error) throw toApiError(error);
}

export async function sendPasswordReset(email: string): Promise<void> {
  const next = email.trim().toLowerCase();
  const { error } = await supabase.auth.resetPasswordForEmail(next, { redirectTo: webOrigin() });
  if (error) throw toApiError(error);
}

/** Verify the emailed recovery code (the "code" path — the "link" path lands with a recovery session). */
export async function verifyRecoveryOtp(email: string, token: string): Promise<void> {
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: token.trim(),
    type: 'recovery',
  });
  if (error) {
    const msg = String(error.message ?? '');
    if (/expired/i.test(msg)) throw new ApiError(410, 'That code has expired — send a new one.');
    throw new ApiError(400, 'That code didn’t work — check for typos, or send a new one.');
  }
  if (!data.session) throw new ApiError(400, 'That code didn’t work — check for typos, or send a new one.');
}

export async function signOutOtherSessions(): Promise<void> {
  const { error } = await supabase.auth.signOut({ scope: 'others' });
  if (error) throw toApiError(error);
}

export async function deleteAccount(password: string): Promise<void> {
  await rpc('delete_account', { p_password: String(password ?? '') });
}

/* ------------------------------------------------------- discover & people */

export async function discover(): Promise<DiscoverPage> {
  return rpc<DiscoverPage>('discover_feed', { p_limit: 30, p_offset: 0 });
}

export async function loadProfile(id: number): Promise<FullProfile> {
  const profile = await rpc<unknown>('load_profile', { p_target_id: id });
  if (!profile) throw new ApiError(404, 'This Space isn’t available.');
  // Normalised at the boundary, not inside the screen: `load_profile` composes
  // its payload from three functions and merges Moments in conditionally, and its
  // jsonb columns can be null. A screen that indexes a missing key is a white
  // page, which is how this was found.
  return profileShape(profile);
}

export async function crushes(): Promise<CrushesResponse> {
  return rpc<CrushesResponse>('crushes_feed');
}

export async function crush(id: number, opts: { deep?: boolean; note?: string } = {}): Promise<CrushResult> {
  return rpc<CrushResult>('crush_member', {
    p_target_id: id,
    p_is_deep: !!opts.deep,
    p_note: opts.note?.trim() || null,
  });
}

/**
 * Add Up: ask to connect.
 *
 * The verb is old and the mechanism is new — the database turns this into a
 * request a person answers, and answers one from the other side if it is already
 * waiting. `request` says which of those happened.
 */
export async function addUp(id: number, opts: { deep?: boolean; note?: string } = {}): Promise<CrushResult> {
  return crush(id, opts);
}

/** Accept the request they sent you: the pair becomes a connection. */
export async function acceptAddUp(id: number): Promise<{ connected: boolean; profile: Profile | null }> {
  return rpc('accept_connection_request', { p_from_id: id });
}

/** Decline it. Nothing is sent back — a refusal is not news. */
export async function declineAddUp(id: number): Promise<{ declined: boolean }> {
  return rpc('decline_connection_request', { p_from_id: id });
}

/** Withdraw a request of mine that has not been answered. */
export async function cancelAddUp(id: number): Promise<{ cancelled: boolean }> {
  return rpc('cancel_connection_request', { p_to_id: id });
}

export async function uncrush(id: number): Promise<void> {
  await rpc('uncrush_member', { p_target_id: id });
}

export async function pass(id: number): Promise<void> {
  await rpc('pass_member', { p_target_id: id });
}

export async function removeConnection(id: number): Promise<void> {
  await rpc('remove_connection', { p_target_id: id });
}

export async function block(id: number): Promise<void> {
  await rpc('block_member', { p_target_id: id });
}

export async function unblock(id: number): Promise<void> {
  await rpc('unblock_member', { p_target_id: id });
}

export async function report(
  id: number,
  body: { reason: string; details?: string; context?: string; alsoBlock?: boolean },
): Promise<{ ok: true; blocked: boolean }> {
  return rpc('report_member', {
    p_target_id: id,
    p_reason: oneOf(body.reason, 'Reason', REPORT_REASONS),
    p_details: str(body.details ?? '', 'Details', { max: 1000 }),
    p_context: str(body.context ?? '', 'Context', { max: 60 }),
    p_also_block: !!body.alsoBlock,
  });
}

export const REPORT_REASONS = [
  'fake_profile', 'harassment', 'inappropriate_content', 'scam', 'underage', 'hate_speech', 'threats_safety', 'other',
] as const;

export async function listBlocks(): Promise<BlockedMember[]> {
  const rows = await rpc<BlockedMember[]>('list_blocks');
  return rows ?? [];
}

/* ---------------------------------------------------------------- messages */

export async function conversations(): Promise<ConversationSummary[]> {
  const res = await rpc<{ items: ConversationSummary[] }>('list_conversations');
  return res.items ?? [];
}

export async function conversation(id: number): Promise<ConversationDetail> {
  return rpc<ConversationDetail>('load_conversation', { p_conversation_id: id });
}

/**
 * Opening a chat asks for a Whisper. The request — not the tap — is what the
 * backend records, so the thread opens with the sender allowed two messages and
 * the recipient holding accept/decline. The returned state says which side of
 * that the caller is on, so the screen does not have to guess.
 */
export async function openConversation(userId: number): Promise<{ id: number; whisper?: WhisperState | null }> {
  const res = await rpc<{ id: number; whisper?: WhisperState | null }>('open_conversation', { p_target_id: userId });
  return { id: res.id, whisper: res.whisper ?? null };
}

/** Answer a waiting Whisper request from inside the thread. */
export async function acceptWhisper(conversationId: number): Promise<boolean> {
  return rpc<boolean>('holup_accept_whisper', { p_conversation_id: conversationId });
}

export async function declineWhisper(conversationId: number): Promise<boolean> {
  return rpc<boolean>('holup_decline_whisper', { p_conversation_id: conversationId });
}

/**
 * Let anyone who can reach your Space whisper you without waiting for a tap.
 * It changes who may start a conversation; it never opens one on its own.
 */
export async function setWhisperOpen(open: boolean): Promise<boolean> {
  return rpc<boolean>('holup_set_whisper_open', { p_open: open });
}

export async function getMessages(
  conversationId: number,
  opts: { after?: number; before?: number; limit?: number } = {},
): Promise<{ items: Message[]; hasMore: boolean; lastReadMine: number | null }> {
  return rpc('get_messages', {
    p_conversation_id: conversationId,
    p_after_id: opts.after ?? 0,
    p_before_id: opts.before ?? 0,
    p_limit: opts.limit ?? 40,
  });
}

export async function sendMessage(conversationId: number, draft: SendDraft): Promise<Message> {
  let mediaPath: string | null = null;
  let meta: Record<string, unknown> = {};
  let body = '';
  if (draft.replyTo) meta.replyTo = { id: draft.replyTo };
  if (draft.kind === 'text') {
    body = str(draft.body, 'Whisper', { required: true, max: 2000 });
  } else if (draft.kind === 'sticker') {
    meta = { sticker: draft.sticker };
  } else if (draft.kind === 'profile') {
    meta = { profileId: draft.profileId };
  } else if (draft.kind === 'post') {
    // The server rebuilds the card from the row; the id is all it needs.
    meta = { postId: draft.postId };
  } else if (draft.kind === 'photo') {
    const type = draft.mimeType || 'image/jpeg';
    body = str(draft.caption ?? '', 'Caption', { max: 300 });
    mediaPath = await uploadToMessages(draft.uri, type);
  } else if (draft.kind === 'voice') {
    const type = draft.mimeType || 'audio/m4a';
    mediaPath = await uploadToMessages(draft.uri, type);
    meta = { duration: draft.duration };
  } else if (draft.kind === 'call') {
    meta = callMessageMeta(draft.channel);
    body = 'Voice call';
  } else if (draft.kind === 'video') {
    const type = draft.mimeType || 'video/mp4';
    mediaPath = await uploadToMessages(draft.uri, type);
    meta = { duration: draft.duration };
  }
  return rpc<Message>('send_message', {
    p_conversation_id: conversationId,
    p_kind: draft.kind,
    p_body: body,
    p_media_url: mediaPath,
    p_meta: meta,
  });
}

async function uploadToMessages(uri: string, mimeType: string): Promise<string> {
  const id = await meId();
  return uploadMediaFile(
    'media',
    `messages/${id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extensionFor(mimeType)}`,
    uri,
    mimeType,
  );
}

export async function markConversationRead(conversationId: number): Promise<void> {
  await rpc('mark_conversation_read', { p_conversation_id: conversationId });
}

/**
 * "I have these now."
 *
 * Called when a message reaches this device, which is a weaker claim than
 * reading it — so it is a separate call and a separate column. Idempotent on the
 * server: the stamp is the first arrival and never moves.
 */
export async function markMessagesDelivered(
  conversationId: number,
  upToId?: number,
): Promise<{ upTo: number; count: number }> {
  return rpc('mark_messages_delivered', {
    p_conversation_id: conversationId,
    p_up_to_id: upToId ?? null,
  });
}

/** What the header may say about them — presence, receipts, and my own switch. */
export async function peerPresence(conversationId: number): Promise<PeerPresence> {
  return rpc('peer_presence', { p_conversation_id: conversationId });
}

export async function reactToMessage(messageId: number, kind = 'crush'): Promise<Message> {
  return rpc<Message>('toggle_message_reaction', { p_message_id: messageId, p_kind: kind });
}

/* ----------------------------------------------------------------- moments */

export async function momentsFeed(): Promise<MomentsFeed> {
  const [flat, me] = await Promise.all([
    rpc<FeedMoment[]>('visible_moments'),
    myAuthorCard(),
  ]);
  return groupMomentFeed(flat ?? [], me);
}

async function myAuthorCard(): Promise<MomentAuthor> {
  const id = await meId();
  const p = unwrap(await supabase.from('profiles').select('name, verification').eq('id', id).single()) as Record<string, any>;
  const photos = unwrap(await supabase.from('photos').select('url').eq('user_id', id).order('position').order('id').limit(1)) as { url: string }[];
  return { id, name: p.name || 'Member', verified: p.verification === 'verified', photo: photos[0]?.url ?? null, mutual: false };
}

export async function createMoment(input: {
  kind: 'text' | 'photo' | 'video';
  body: string;
  style: MomentStyle;
  audience: 'everyone' | 'connections';
  photoUri?: string;
  photoMime?: string;
  videoUri?: string;
  videoMime?: string;
  durationMs?: number | null;
  edit?: LiveEdit | null;
}): Promise<Moment> {
  const max = input.kind === 'text' ? 280 : 200;
  const body = str(input.body, input.kind === 'text' ? 'Your Moment' : 'Caption', {
    required: input.kind === 'text',
    max,
  });
  let mediaPath: string | null = null;
  if (input.kind === 'photo') {
    if (!input.photoUri) throw new ApiError(400, 'Choose a photo to share.');
    const type = input.photoMime || 'image/jpeg';
    const id = await meId();
    mediaPath = await uploadMediaFile('media', `moments/${id}/${Date.now()}.${extensionFor(type)}`, input.photoUri, type);
  }
  if (input.kind === 'video') {
    if (!input.videoUri) throw new ApiError(400, 'Choose a clip to share.');
    if (!input.durationMs || input.durationMs < 100 || input.durationMs > 60_000) {
      throw new ApiError(400, 'Choose a clip that is no longer than 1 minute.');
    }
    const type = (input.videoMime || 'video/mp4').toLowerCase();
    const id = await meId();
    // extensionFor() maps mp4 to m4a, which is right for
    // a voice note and wrong for a clip.
    mediaPath = await uploadMediaFile(
      'media',
      `moments/${id}/${Date.now()}.${type.includes('webm') ? 'webm' : 'mp4'}`,
      input.videoUri,
      type,
    );
  }
  const moment = await rpc<Moment>('create_moment', {
    p_kind: input.kind,
    p_body: body,
    p_media_url: mediaPath,
    p_style: input.style,
    p_audience: input.audience,
    ...(input.edit ? { p_edit: input.edit as unknown as Record<string, unknown> } : {}),
    ...(input.kind === 'video' ? { p_duration_ms: input.durationMs } : {}),
  });
  return moment;
}

export async function deleteMoment(id: number): Promise<void> {
  const me = await meId();
  const row = await supabase
    .from('moments')
    .select('media_url')
    .eq('id', id)
    .eq('user_id', me)
    .maybeSingle();
  await rpc('delete_moment', { p_moment_id: id });
  if (!row.error && (row.data as { media_url?: string } | null)?.media_url) {
    await removeMediaFile((row.data as { media_url: string }).media_url);
  }
}

export async function viewMoment(id: number): Promise<void> {
  await rpc('view_moment', { p_moment_id: id });
}

export async function reactToMoment(id: number, kind: string | null): Promise<Moment> {
  return rpc<Moment>('react_to_moment', { p_moment_id: id, p_kind: kind });
}

/** Resolve a specific reply through the server; never trust a cached quote. */
export async function whisperMomentTarget(messageId: number): Promise<{ momentId: number; userId: number; mine: boolean } | null> {
  return rpc('whisper_moment_target', { p_message_id: messageId });
}

export async function replyToMoment(id: number, body: string): Promise<{ conversationId: number }> {
  return rpc('reply_to_moment', { p_moment_id: id, p_body: str(body, 'Reply', { required: true, max: 1000 }) });
}

/* ----------------------------------------------------------- notifications */

export async function notifications(): Promise<AppNotification[]> {
  const rows = await rpc<AppNotification[]>('list_notifications');
  return rows ?? [];
}

export async function markNotificationsRead({ ids, kinds }: { ids?: number[]; kinds?: string[] } = {}): Promise<void> {
  const id = await meId();
  const read_at = Date.now();
  if (ids && ids.length) {
    unwrap(await supabase.from('notifications').update({ read_at }).eq('user_id', id).in('id', ids));
  } else if (kinds && kinds.length) {
    unwrap(await supabase.from('notifications').update({ read_at }).eq('user_id', id).in('kind', kinds));
  } else {
    unwrap(await supabase.from('notifications').update({ read_at }).eq('user_id', id).is('read_at', null));
  }
}

/** Lightweight counters polled by the tab bar; also serves as a heartbeat. */
export async function badges(): Promise<Badges> {
  void supabase.rpc('heartbeat').then(() => {});
  return rpc<Badges>('badges');
}

/* ------------------------------------------------------------ vocabularies */

// Validation lists come from the app catalog (src/lib/catalog.ts) so the UI
// and the API always accept the same values.
export const INTENTIONS: string[] = catalogIntentions.map((i) => i.value);
export const INTERESTS: string[] = catalogInterests;
export const LANGUAGES: string[] = catalogLanguages;
export const RELATIONSHIP_INTENTIONS: string[] = catalogRelationshipIntentions;

/* ----------------------------------------------------------------- search */

/** People whose handle or name starts with what is being typed after `@`. */
export async function mentionSuggest(query: string): Promise<{ id: number; name: string; username: string; photo: string | null; connected: boolean }[]> {
  return rpc('mention_suggest', { p_query: String(query ?? '').slice(0, 30) });
}

/** Tags already used in Flows this member can open, most used first. */
export async function tagSuggest(query: string): Promise<{ tag: string; uses: number }[]> {
  return rpc('tag_suggest', { p_query: String(query ?? '').slice(0, 30) });
}

/** Members you can already see, plus the Flows and Moments you may see. */
/** Real terms from posts and comments the caller is allowed to read. */
export async function holupTrends(): Promise<{ term: string; postCount: number }[]> {
  return rpc('holup_trends', { p_limit: 10 });
}

export async function searchAll(query: string, category: SearchCategory, filters: SearchFilters): Promise<SearchResults> {
  const q = String(query ?? '').trim();
  if (q.length < 2) return { members: [], posts: [], moments: [], sounds: [], places: [], hashtags: [] };
  return rpc<SearchResults>('search_holup', {
    p_query: q, p_category: category, p_since: filters.since, p_sort: filters.sort,
    p_author: filters.author, p_content: filters.content, p_hashtag: filters.hashtag, p_limit: 40, p_place: filters.place,
  });
}

/**
 * A handle to the Space behind it.
 *
 * A mention is only worth printing in a colour if pressing it goes somewhere,
 * so this is the smallest honest lookup: one column, one row, exact handle.
 * Handles are stored lower-case at signup, and compared the same way here —
 * `@Ada` and `@ada` are the same person, which is what everyone expects.
 */
export async function profileIdByUsername(username: string): Promise<number | null> {
  // Trailing punctuation is the sentence's, not the handle's: "ask @ada." is a
  // mention of ada.
  const handle = String(username ?? '')
    .replace(/^@+/, '')
    .trim()
    .replace(/[.,;:!?]+$/, '')
    .toLowerCase();
  if (!handle) return null;
  requireConfig();
  const byHandle = await supabase
    .from('profiles')
    .select('id')
    .ilike('username', handle)
    .limit(1)
    .maybeSingle();
  if (byHandle.error) throw toApiError(byHandle.error);
  if (byHandle.data?.id != null) return byHandle.data.id;

  // The suggestion list and the handle have to agree, and when they do not the
  // member is still right: they were shown a person, they tagged that person.
  // So a name that matches exactly is honoured too — that is how a tag written
  // before somebody changed their handle keeps working.
  const byName = await supabase
    .from('profiles')
    .select('id')
    .ilike('name', handle)
    .limit(1)
    .maybeSingle();
  if (byName.error) return null;
  return byName.data?.id ?? null;
}

/** Posts people chose to share with Everyone — the public side of Flows. */
export async function publicFlow(): Promise<Post[]> {
  const res = await rpc<{ items: Post[] }>('public_flow_feed', { p_limit: 20 });
  return res?.items ?? [];
}

/* ----------------------------------------------------------------- updates */

/**
 * Asks our own Worker what the current build is.
 *
 * Deliberately not GitHub, and not the Play Store: a member is never handed a
 * link into our infrastructure, and the address we call is the same one that
 * already serves the app's media. A failure here is not an error worth showing
 * anybody — the app simply carries on at the version it has.
 */
export async function appUpdate(): Promise<AppUpdate> {
  const channel = Constants.expoConfig?.extra?.androidUpdateChannel;
  const res = await fetch(`${MEDIA_BASE_URL}${updateVersionPath(Platform.OS, channel, Constants.expoConfig?.android?.package)}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new ApiError(res.status, 'Couldn’t check for an update.');
  return (await res.json()) as AppUpdate;
}
