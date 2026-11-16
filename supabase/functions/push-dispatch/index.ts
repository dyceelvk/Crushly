/**
 * holUpp push dispatch — the server half of "it rang while the app was closed".
 *
 * A database trigger on `notifications` and `messages` POSTs the new row here.
 * This function decides who is told, in what words, on which channel, and hands
 * the message to Firebase Cloud Messaging, which is the only thing that can wake a
 * phone that is not running holUpp.
 *
 * Rules it follows, mirroring the app so the two never disagree:
 *
 *  · Never to the person who did it. A message you sent does not notify you.
 *  · Respect the member's switches in `notification_settings` (messages, crushes,
 *    moments, keeps, recommendations). Switched off there means no push at all.
 *  · The sound is the phone's own choice, stored on the token row, because a
 *    channel's sound is fixed when Android creates it.
 *  · A token Firebase rejects is deleted, not retried forever.
 *  · No credentials means no push — and a recorded reason, not a silent nothing.
 *
 * Secrets: FCM_SERVICE_ACCOUNT, the service-account JSON from the Firebase
 * console (the whole file, as one string).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SA_JSON = Deno.env.get('FCM_SERVICE_ACCOUNT') ?? '';

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

interface Token {
  token: string;
  sound: string | null;
  platform: string;
}

interface Payload {
  title: string;
  body: string;
  route: 'messages' | 'notifications';
  source: string;
  recordId: number | null;
  recipientIds: number[];
}

/* ------------------------------------------------------------------- FCM auth */

let cachedToken: { value: string; expiresAt: number; projectId: string } | null = null;

function b64url(bytes: Uint8Array | string): string {
  const raw = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  let binary = '';
  for (const b of raw) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToDer(pem: string): Uint8Array {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const binary = atob(body);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 60 > now && cachedToken.projectId === sa.project_id) {
    return cachedToken.value;
  }
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claim}`;
  // RS256 with the account's own key: nothing here needs a library, and a
  // dependency in a webhook path is one more thing that can be unavailable.
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${b64url(new Uint8Array(signature))}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) {
    throw new Error(`oauth ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
  }
  cachedToken = {
    value: json.access_token,
    expiresAt: now + (json.expires_in ?? 3600),
    projectId: sa.project_id,
  };
  return cachedToken.value;
}

/* ------------------------------------------------------------------ wording */

function titleFor(kind: string): string {
  switch (kind) {
    case 'crush': return 'New Add Up';
    case 'deep_crush': return 'Somebody is really into you';
    case 'mutual': return 'It is mutual';
    case 'moment_reply': return 'A reply to your Moment';
    case 'moment_reaction': return 'A reaction to your Moment';
    case 'verified': return 'You are verified';
    case 'verification_rejected': return 'About your verification';
    case 'post_reaction': return 'A reaction to your post';
    case 'post_comment': return 'A new comment';
    case 'post_mention': return 'Somebody mentioned you';
    case 'keep': return 'Somebody is keeping you close';
    case 'message': return 'New Whisper';
    default: return 'holUpp';
  }
}

/** Which switch in `notification_settings` governs this kind, if any. */
function settingFor(kind: string): 'messages' | 'crushes' | 'moments' | 'keeps' | 'recommendations' | null {
  if (kind === 'message') return 'messages';
  if (kind === 'crush' || kind === 'deep_crush' || kind === 'mutual') return 'crushes';
  if (kind.startsWith('moment_')) return 'moments';
  if (kind === 'keep') return 'keeps';
  if (kind === 'recommendation') return 'recommendations';
  return null;
}

/* ------------------------------------------------------------------ payload */

async function buildPayload(source: string, record: Record<string, unknown>): Promise<Payload | null> {
  const recordId = Number(record.id ?? 0) || null;

  if (source === 'messages') {
    const conversationId = Number(record.conversation_id);
    const senderProfile = Number(record.sender_id);
    if (!conversationId || !senderProfile) return null;
    if ((record.kind ?? '') === 'call') return null; // a ringing call is not a notification
    const { data: conv } = await db
      .from('conversations')
      .select('user_a,user_b,closed')
      .eq('id', conversationId)
      .maybeSingle();
    if (!conv || conv.closed) return null;
    const recipient = Number(conv.user_a) === senderProfile ? Number(conv.user_b) : Number(conv.user_a);
    if (!recipient || recipient === senderProfile) return null;
    const body = typeof record.body === 'string' && record.body.trim()
      ? record.body.trim()
      : 'Sent you a Whisper';
    return {
      title: 'New Whisper',
      body: body.slice(0, 160),
      route: 'messages',
      source,
      recordId,
      recipientIds: [recipient],
    };
  }

  if (source === 'notifications') {
    const recipient = Number(record.user_id);
    const actor = record.actor_id == null ? null : Number(record.actor_id);
    if (!recipient) return null;
    // The one rule that matters most: never tell somebody about their own action.
    if (actor && actor === recipient) return null;
    const kind = String(record.kind ?? '');
    if (kind === 'message') return null; // Whispers travel through the messages path
    return {
      title: titleFor(kind),
      body: String(record.body ?? '').slice(0, 200) || 'Something happened on holUpp',
      route: 'notifications',
      source,
      recordId,
      recipientIds: [recipient],
    };
  }

  return null;
}

/* ------------------------------------------------------------------- sending */

async function tokensFor(recipientIds: number[]): Promise<Map<number, Token[]>> {
  const byRecipient = new Map<number, Token[]>();
  const { data } = await db
    .from('device_tokens')
    .select('profile_id,token,sound,platform')
    .in('profile_id', recipientIds);
  for (const row of data ?? []) {
    const list = byRecipient.get(row.profile_id) ?? [];
    list.push({ token: row.token, sound: row.sound, platform: row.platform });
    byRecipient.set(row.profile_id, list);
  }
  return byRecipient;
}

async function allows(recipientId: number, kind: string | null): Promise<boolean> {
  if (!kind) return true;
  const setting = settingFor(kind);
  if (!setting) return true;
  const { data } = await db
    .from('notification_settings')
    .select(setting)
    .eq('user_id', recipientId)
    .maybeSingle();
  // No row means the member never changed anything, and the app's own default is
  // "on". Treating a missing row as "off" would silently mute new accounts.
  if (!data) return true;
  return (data as Record<string, boolean>)[setting] !== false;
}

async function sendTo(token: Token, payload: Payload, access: string, projectId: string): Promise<'ok' | 'gone' | 'fail'> {
  // Channels are per sound, because Android fixes a channel's sound at creation.
  const channel = `holup-alerts-${token.sound ?? 'glass'}`;
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token: token.token,
        notification: { title: payload.title, body: payload.body },
        data: { route: payload.route, source: payload.source, recordId: String(payload.recordId ?? '') },
        android: {
          priority: 'HIGH',
          notification: {
            channel_id: channel,
            // Tapping opens the app; the app then reads `route` and lands on the
            // chat or the Notifications list rather than the home feed.
            click_action: 'OPEN_APP',
          },
        },
        apns: { payload: { aps: { sound: 'default', 'mutable-content': 0 } } },
      },
    }),
  });
  if (res.ok) return 'ok';
  const text = await res.text();
  // 404 UNREGISTERED / 400 INVALID_ARGUMENT for a dead token: delete it instead of
  // retrying it on every future message.
  if (res.status === 404 || text.includes('UNREGISTERED') || text.includes('INVALID_ARGUMENT')) {
    await db.from('device_tokens').delete().eq('token', token.token);
    return 'gone';
  }
  return 'fail';
}

/**
 * The caller must prove it is our own database.
 *
 * The shared secret is generated inside Postgres and only ever lives in
 * `push_config` and in the request the trigger makes — it is never an environment
 * variable, never in the app, and cannot be read by a client. The service role key
 * is what this function uses to read it back.
 */
async function callerIsOurDatabase(req: Request): Promise<boolean> {
  const presented = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!presented) return false;
  const { data } = await db.from('push_config').select('dispatch_key').eq('id', 1).maybeSingle();
  const expected = data?.dispatch_key;
  if (!expected) return false;
  // Length-independent comparison: a timing signal should not tell anybody how much
  // of the secret they guessed right.
  if (presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < presented.length; i += 1) diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  if (!(await callerIsOurDatabase(req))) return Response.json({ error: 'forbidden' }, { status: 401 });

  let body: { source?: string; record?: Record<string, unknown> } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ skipped: 'no body' }, { status: 400 });
  }
  const source = String(body.source ?? '');
  const record = body.record ?? {};
  if (!source || !record.id) return Response.json({ skipped: 'no record' }, { status: 400 });

  const payload = await buildPayload(source, record);
  if (!payload) return Response.json({ skipped: 'nothing to say' });

  const kindGuess = source === 'messages' ? 'message' : String(record.kind ?? '');

  // Preferences first: a push is a stranger arriving on somebody's lock screen, so
  // a switch that is off must mean silence before any work is done.
  const allowed: number[] = [];
  for (const id of payload.recipientIds) {
    if (await allows(id, kindGuess)) allowed.push(id);
  }
  if (allowed.length === 0) {
    await db.from('push_attempts').insert({
      recipient_id: payload.recipientIds[0], source, record_id: payload.recordId,
      title: payload.title, body: payload.body, sent: 0, failed: 0, note: 'muted by member settings',
    });
    return Response.json({ skipped: 'muted' });
  }

  const tokens = await tokensFor(allowed);
  const all = [...tokens.values()].flat();

  if (!SA_JSON) {
    // Honest failure: the event happened, nobody could be woken, and the reason is
    // written down where it can be seen.
    await db.from('push_attempts').insert({
      recipient_id: allowed[0], source, record_id: payload.recordId,
      title: payload.title, body: payload.body, sent: 0, failed: all.length,
      note: 'FCM service account not configured',
    });
    return Response.json({ sent: 0, reason: 'fcm_not_configured' }, { status: 200 });
  }
  if (all.length === 0) {
    await db.from('push_attempts').insert({
      recipient_id: allowed[0], source, record_id: payload.recordId,
      title: payload.title, body: payload.body, sent: 0, failed: 0, note: 'no registered devices',
    });
    return Response.json({ sent: 0, reason: 'no_devices' });
  }

  let sa: ServiceAccount;
  try {
    sa = JSON.parse(SA_JSON);
  } catch {
    await db.from('push_attempts').insert({
      recipient_id: allowed[0], source, record_id: payload.recordId,
      sent: 0, failed: all.length, note: 'FCM_SERVICE_ACCOUNT is not valid JSON',
    });
    return Response.json({ error: 'bad service account' }, { status: 500 });
  }

  let access: string;
  try {
    access = await accessToken(sa);
  } catch (e) {
    await db.from('push_attempts').insert({
      recipient_id: allowed[0], source, record_id: payload.recordId,
      sent: 0, failed: all.length, note: `oauth failed: ${(e as Error).message}`.slice(0, 300),
    });
    return Response.json({ error: 'oauth failed' }, { status: 502 });
  }

  let sent = 0;
  let failed = 0;
  for (const token of all) {
    const result = await sendTo(token, payload, access, sa.project_id);
    if (result === 'ok') sent += 1;
    else if (result === 'fail') failed += 1;
  }

  await db.from('push_attempts').insert({
    recipient_id: allowed[0], source, record_id: payload.recordId,
    title: payload.title, body: payload.body, sent, failed, note: null,
  });

  return Response.json({ sent, failed });
});
