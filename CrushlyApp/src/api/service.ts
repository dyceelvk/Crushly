import { supabase, ApiError, extensionFor, removeMediaFile, requireConfig, toApiError, uploadMediaFile } from './client';
import { callMessageMeta } from '../lib/callChannel';
import { ageFromBirthdate } from '../lib/format';
import { groupMomentFeed, type FeedMoment } from '../lib/moments';
import {
  INTENTIONS as catalogIntentions,
  INTERESTS as catalogInterests,
  LANGUAGES as catalogLanguages,
  RELATIONSHIP_INTENTIONS as catalogRelationshipIntentions,
} from '../lib/catalog';
import type {
  AppNotification, Badges, BlockedMember, ConversationDetail, ConversationSummary, CrushesResponse, CrushResult,
  DiscoverPage, FullProfile, Me, Message, Moment, MomentAuthor, MomentsFeed, Preferences, Privacy,
  NotificationSettings, Profile, MomentStyle,
} from './types';

/**
 * The Crushly data layer — a 1:1 port of the retired Express API onto Supabase.
 * Simple things are plain table reads/writes on the member's own
 * rows (RLS-protected); everything cross-member runs through the RPCs defined
 * in supabase/migrations/20261008000002_functions.sql.
 */

const FREE_DEEP_CRUSHES_PER_DAY = 3;
const MAX_PHOTOS = 6;

export type SendDraft =
  | { kind: 'text'; body: string }
  | { kind: 'sticker'; sticker: string }
  | { kind: 'profile'; profileId: number }
  | { kind: 'photo'; uri: string; mimeType?: string; caption?: string }
  | { kind: 'voice'; uri: string; duration: number; mimeType?: string }
  | { kind: 'video'; uri: string; duration: number; mimeType?: string }
  | { kind: 'call'; channel: string };

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

function completion(profile: Record<string, any>, photos: { id: number }[]) {
  const interests: string[] = profile.interests ?? [];
  const languages: string[] = profile.languages ?? [];
  const lifestyle: Record<string, unknown> = profile.lifestyle ?? {};
  const checks = [
    { label: 'Add a photo', weight: 20, done: photos.length >= 1 },
    { label: 'Add at least 3 photos', weight: 10, done: photos.length >= 3 },
    { label: 'Name and birthday', weight: 10, done: !!profile.name && !!profile.birthdate },
    { label: 'Write a bio', weight: 15, done: (profile.bio ?? '').length >= 20 },
    { label: 'Pick 3 interests', weight: 10, done: interests.length >= 3 },
    { label: 'Say what you’re looking for', weight: 10, done: (profile.intentions ?? []).length > 0 },
    { label: 'Relationship intention', weight: 5, done: !!profile.relationship_intention },
    { label: 'Pronouns', weight: 5, done: !!profile.pronouns },
    { label: 'Languages', weight: 5, done: languages.length > 0 },
    { label: 'Lifestyle details', weight: 5, done: Object.keys(lifestyle).length >= 2 },
    { label: 'Your city', weight: 5, done: !!profile.city },
  ];
  const percent = checks.reduce((sum, c) => sum + (c.done ? c.weight : 0), 0);
  return { percent, missing: checks.filter((c) => !c.done).map((c) => c.label) };
}

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
      .select('id', { count: 'exact', head: true })
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
    completion: completion(p, photos),
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
    // Crushly Plus isn't for sale yet — entitlements are wired so features can light up later.
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
    if (age != null && age < 18) throw new ApiError(400, 'Crushly is for adults. You need to be 18 or older to join.');
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
  if (profile.onboarded && (count ?? 0) <= 1) throw new ApiError(400, 'Keep at least one photo on your profile.');
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
  const ageMin = Math.min(99, Math.max(18, Math.round(prefs.ageMin)));
  const ageMax = Math.min(99, Math.max(18, Math.round(prefs.ageMax)));
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
  readReceipts: ['read_receipts', 'bool'],
  discoverable: ['discoverable', 'bool'],
  showAge: ['show_age', 'bool'],
  showCity: ['show_city', 'bool'],
  profileVisibility: ['profile_visibility', ['everyone', 'connections']],
  whoCanMessage: ['who_can_message', ['everyone', 'crushes', 'mutual']],
  whoCanCrush: ['who_can_crush', ['everyone', 'verified']],
};

export async function updatePrivacy(patch: Partial<Privacy>): Promise<Me> {
  if (patch.incognito) {
    throw new ApiError(
      402,
      'Incognito is part of Crushly Plus, which isn’t available yet. Hide your profile from Discover instead — it’s free.',
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

export async function resendConfirmation(email: string): Promise<void> {
  const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim().toLowerCase() });
  if (error) throw toApiError(error);
}

export async function sendPasswordReset(email: string): Promise<void> {
  const next = email.trim().toLowerCase();
  const { error } = await supabase.auth.resetPasswordForEmail(next, {
    redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
  });
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
  const profile = await rpc<FullProfile | null>('load_profile', { p_target_id: id });
  if (!profile) throw new ApiError(404, 'This profile isn’t available.');
  return profile;
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

export async function openConversation(userId: number): Promise<{ id: number }> {
  const res = await rpc<{ id: number }>('open_conversation', { p_target_id: userId });
  return { id: res.id };
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
  if (draft.kind === 'text') {
    body = str(draft.body, 'Message', { required: true, max: 2000 });
  } else if (draft.kind === 'sticker') {
    meta = { sticker: draft.sticker };
  } else if (draft.kind === 'profile') {
    meta = { profileId: draft.profileId };
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
  kind: 'text' | 'photo';
  body: string;
  style: MomentStyle;
  audience: 'everyone' | 'connections';
  photoUri?: string;
  photoMime?: string;
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
  const moment = await rpc<Moment>('create_moment', {
    p_kind: input.kind,
    p_body: body,
    p_media_url: mediaPath,
    p_style: input.style,
    p_audience: input.audience,
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
