// holUpp push dispatch — the server half of "it rang while the app was closed".
//
// A database trigger on `notifications` and `messages` POSTs the new row here.
// This function decides who is told, in what words, on which channel, and hands the
// message to Firebase Cloud Messaging — the only thing that can wake a phone that is
// not running holUpp.
//
// Rules it follows, mirroring the app so the two never disagree:
//
//  · Never to the person who did it. A message you sent does not notify you.
//  · Respect the member's switches in `notification_settings`.
//  · The sound is the phone's own choice, stored on the token row, because Android
//    fixes a channel's sound when the channel is created.
//  · A token Firebase rejects is deleted, not retried forever.
//  · No credentials means no push — and a recorded reason, not a silent nothing.
//
// No imports at all, deliberately: this is a webhook that runs on every message, and
// a module fetched from a CDN at boot is one more way for it to fail to start. The
// database is reached over PostgREST with `fetch`, which is built in.
//
// Secret: FCM_SERVICE_ACCOUNT — the service-account JSON from the Firebase console,
// the whole file as one string.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SA_JSON = Deno.env.get('FCM_SERVICE_ACCOUNT') ?? '';

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

/* --------------------------------------------------------------- the database */

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

async function one<T>(path: string): Promise<T | null> {
  const res = await rest(path);
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0 ? (rows[0] as T) : null;
}

async function many<T>(path: string): Promise<T[]> {
  const res = await rest(path);
  if (!res.ok) return [];
  const rows = await res.json();
  return Array.isArray(rows) ? (rows as T[]) : [];
}

async function logAttempt(row: Record<string, unknown>): Promise<void> {
  // A log that can fail the send is not a log, it is a second outage.
  try {
    await rest('push_attempts', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ created_at: Date.now(), ...row }),
    });
  } catch {
    /* nothing to be done about it here */
  }
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

/**
 * A Google access token, minted from the service account's own key.
 *
 * RS256 with WebCrypto: the assertion is signed locally, so the only network call is
 * the token exchange, and there is no library in the path to be broken or out of date.
 */
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

/* -------------------------------------------------------------------- wording */

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

/* -------------------------------------------------------------------- payload */

async function buildPayload(source: string, record: Record<string, unknown>): Promise<Payload | null> {
  const recordId = Number(record.id ?? 0) || null;

  if (source === 'messages') {
    const conversationId = Number(record.conversation_id);
    const senderProfile = Number(record.sender_id);
    if (!conversationId || !senderProfile) return null;
    if ((record.kind ?? '') === 'call') return null; // a ringing call is not a notification
    const conv = await one<{ user_a: number; user_b: number; closed: boolean }>(
      `conversations?id=eq.${conversationId}&select=user_a,user_b,closed`,
    );
    if (!conv || conv.closed) return null;
    const recipient = Number(conv.user_a) === senderProfile ? Number(conv.user_b) : Number(conv.user_a);
    if (!recipient || recipient === senderProfile) return null;
    const body = typeof record.body === 'string' && record.body.trim()
      ? record.body.trim()
      : 'Sent you a Whisper';
    return {
      title: 'New Whisper',
      // The message text itself, cut short. A Whisper is the one thing worth reading
      // on a lock screen; the rest are titles.
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
    if (actor && actor === recipient) return null;
    const kind = String(record.kind ?? '');
    if (kind === 'message') return null; // Whispers travel the messages path
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

/* -------------------------------------------------------------------- sending */

async function allows(recipientId: number, kind: string | null): Promise<boolean> {
  if (!kind) return true;
  const setting = settingFor(kind);
  if (!setting) return true;
  const row = await one<Record<string, boolean>>(
    `notification_settings?user_id=eq.${recipientId}&select=${setting}`,
  );
  // No row means the member never changed anything and the app's default is on.
  // Reading that as "off" would silently mute every new account.
  if (!row) return true;
  return row[setting] !== false;
}

async function sendTo(token: Token, payload: Payload, access: string, projectId: string): Promise<'ok' | 'gone' | 'fail'> {
  // One channel per chime, because Android fixes a channel's sound at creation and
  // the sound is the phone's choice, not ours.
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
          notification: { channel_id: channel, click_action: 'OPEN_APP' },
        },
        apns: { payload: { aps: { sound: 'default' } } },
      },
    }),
  });
  if (res.ok) return 'ok';
  const text = await res.text();
  // A token Google no longer knows is deleted rather than retried on every future
  // message: dead tokens are how a push system slowly becomes a slow push system.
  if (res.status === 404 || text.includes('UNREGISTERED') || text.includes('INVALID_ARGUMENT')) {
    await rest(`device_tokens?token=eq.${encodeURIComponent(token.token)}`, { method: 'DELETE' });
    return 'gone';
  }
  return 'fail';
}

/* --------------------------------------------------------------------- auth */

/**
 * The caller must prove it is our own database.
 *
 * The shared secret is generated inside Postgres and only ever lives in
 * `push_config` and in the request the trigger makes — never an environment
 * variable, never in the app, and unreadable by a client.
 */
async function callerIsOurDatabase(req: Request): Promise<boolean> {
  const presented = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!presented) return false;
  const config = await one<{ dispatch_key: string }>('push_config?id=eq.1&select=dispatch_key');
  const expected = config?.dispatch_key;
  if (!expected || presented.length !== expected.length) return false;
  // Length-independent comparison: a timing signal must not reveal a guessed prefix.
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

  const allowed: number[] = [];
  for (const id of payload.recipientIds) {
    if (await allows(id, kindGuess)) allowed.push(id);
  }
  if (allowed.length === 0) {
    await logAttempt({
      recipient_id: payload.recipientIds[0], source, record_id: payload.recordId,
      title: payload.title, body: payload.body, sent: 0, failed: 0, note: 'muted by member settings',
    });
    return Response.json({ skipped: 'muted' });
  }

  const rows = await many<Token & { profile_id: number }>(
    `device_tokens?profile_id=in.(${allowed.join(',')})&select=profile_id,token,sound,platform`,
  );

  if (!SA_JSON) {
    // The event happened and nobody could be woken: say so where it can be seen,
    // rather than returning success and letting the silence look like a bug.
    await logAttempt({
      recipient_id: allowed[0], source, record_id: payload.recordId,
      title: payload.title, body: payload.body, sent: 0, failed: rows.length,
      note: 'FCM service account not configured',
    });
    return Response.json({ sent: 0, reason: 'fcm_not_configured' });
  }
  if (rows.length === 0) {
    await logAttempt({
      recipient_id: allowed[0], source, record_id: payload.recordId,
      title: payload.title, body: payload.body, sent: 0, failed: 0, note: 'no registered devices',
    });
    return Response.json({ sent: 0, reason: 'no_devices' });
  }

  let sa: ServiceAccount;
  try {
    sa = JSON.parse(SA_JSON);
  } catch {
    await logAttempt({
      recipient_id: allowed[0], source, record_id: payload.recordId,
      sent: 0, failed: rows.length, note: 'FCM_SERVICE_ACCOUNT is not valid JSON',
    });
    return Response.json({ error: 'bad service account' }, { status: 500 });
  }

  let access: string;
  try {
    access = await accessToken(sa);
  } catch (e) {
    await logAttempt({
      recipient_id: allowed[0], source, record_id: payload.recordId,
      sent: 0, failed: rows.length, note: `oauth failed: ${(e as Error).message}`.slice(0, 300),
    });
    return Response.json({ error: 'oauth failed' }, { status: 502 });
  }

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const result = await sendTo(row, payload, access, sa.project_id);
    if (result === 'ok') sent += 1;
    else if (result === 'fail') failed += 1;
  }

  await logAttempt({
    recipient_id: allowed[0], source, record_id: payload.recordId,
    title: payload.title, body: payload.body, sent, failed, note: null,
  });

  return Response.json({ sent, failed });
});
