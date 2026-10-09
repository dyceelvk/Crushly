// didit-session — starts a Didit hosted verification session for the signed-in
// member. Didit runs the checks (ID document, liveness, face match); we store
// the session and hand back its URL. Results arrive via the didit-webhook
// function (authoritative), or the member taps "Check status" which polls
// Didit through didit-status.
//
// Secrets: SUPABASE_* (automatic) + DIDIT_API_KEY, DIDIT_WORKFLOW_ID, APP_URL.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { DIDIT_BASE } from '../_shared/didit.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

/** Base64 for an ArrayBuffer (chunked — large buffers overflow the spread). */
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const apiKey = Deno.env.get('DIDIT_API_KEY') ?? '';
  const workflowId = Deno.env.get('DIDIT_WORKFLOW_ID') ?? '';
  const appUrl = (Deno.env.get('APP_URL') ?? '').replace(/\/+$/, '');
  if (!apiKey || !workflowId || !appUrl) {
    return json(
      { error: 'Verification is not configured yet — add the DIDIT_API_KEY, DIDIT_WORKFLOW_ID and APP_URL secrets.' },
      503,
    );
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: who, error: whoErr } = await userClient.auth.getUser();
  const user = who?.user;
  if (whoErr || !user) return json({ error: 'sign in required' }, 401);
  const admin = createClient(url, serviceKey);

  const { data: profile, error: profErr } = await admin
    .from('profiles')
    .select('id, email, verification')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (profErr || !profile) return json({ error: 'profile not found' }, 404);
  if (profile.verification === 'verified') return json({ error: 'You’re already verified.' }, 400);

  let newSession = false;
  try {
    const body = await req.json();
    newSession = body?.newSession === true;
  } catch {
    // Older clients send an empty body: default to resuming, not restarting.
  }

  if (!newSession) {
    const { data: existing, error: existingErr } = await admin
      .from('verification_requests')
      .select('didit_session_id, didit_session_url, status, didit_status')
      .eq('user_id', profile.id)
      .not('didit_session_id', 'is', null)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingErr) return json({ error: 'Couldn’t look up your verification session. Please try again.' }, 500);
    if (existing?.status === 'pending' && existing.didit_session_url &&
        !['Expired', 'Abandoned'].includes(existing.didit_status ?? '')) {
      return json({ url: existing.didit_session_url, session_id: existing.didit_session_id });
    }
    // Legacy sessions have no saved URL. Create a replacement once; subsequent
    // Continue taps reuse the saved link instead of spending another session.
  }

  // Face-match workflows need a reference face for a brand-new user: send the
  // member's first profile photo as portrait_image (Didit caps it at 2MB).
  const { data: photo } = await admin
    .from('photos')
    .select('url')
    .eq('user_id', profile.id)
    .order('position', { ascending: true })
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();
  let portraitImage: string | undefined;
  if (photo?.url) {
    try {
      const imgRes = await fetch(`${url}/storage/v1/object/public/media/${photo.url}`);
      if (imgRes.ok) {
        const buf = await imgRes.arrayBuffer();
        if (buf.byteLength > 0 && buf.byteLength <= 2 * 1024 * 1024) portraitImage = toBase64(buf);
      }
    } catch {
      /* no reference face available — Didit explains if it still needs one */
    }
  }

  let session: { session_id?: string; url?: string; status?: string };
  try {
    const res = await fetch(`${DIDIT_BASE}/v3/session/`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflow_id: workflowId,
        vendor_data: String(profile.id),
        callback: `${appUrl}/verification?didit=done`,
        callback_method: 'both',
        language: 'en',
        contact_details: { email: profile.email },
        metadata: { profile_id: profile.id },
        ...(portraitImage ? { portrait_image: portraitImage } : {}),
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return json({ error: String(body?.detail ?? body?.message ?? `Verification provider rejected the request (HTTP ${res.status}).`) }, 502);
    }
    session = body;
  } catch {
    return json({ error: 'Couldn’t reach Didit — try again in a moment.' }, 502);
  }
  if (!session.session_id || !session.url) {
    return json({ error: 'Didit returned an unexpected response.' }, 502);
  }

  // Save/supersede atomically. Creating a link is NOT a review submission.
  const { error: recordErr } = await admin.rpc('record_didit_session', {
    p_user_id: profile.id, p_session_id: session.session_id, p_url: session.url,
  });
  if (recordErr) return json({ error: 'Couldn’t record the session. Please try again.' }, 500);

  return json({ url: session.url, session_id: session.session_id });
});
