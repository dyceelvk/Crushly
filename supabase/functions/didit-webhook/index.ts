// didit-webhook — receives Didit's signed webhooks and settles the member's
// verification. No JWT on this function (config.toml: verify_jwt = false):
// Didit calls it, and the X-Signature-V2 HMAC is the authentication.
//
// Verify the signature over the RAW body BEFORE parsing, dedupe on event_id
// (Didit reuses it across retries), then map the decision onto the member.
//
// Secrets: SUPABASE_* (automatic) + DIDIT_WEBHOOK_SECRET.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyDiditWebhook, diditToAppStatus, appToProfileVerification } from '../_shared/didit.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-signature-v2, x-timestamp',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const secret = Deno.env.get('DIDIT_WEBHOOK_SECRET') ?? '';
  const raw = await req.text();
  const ok = await verifyDiditWebhook(
    raw,
    req.headers.get('X-Signature-V2'),
    req.headers.get('X-Timestamp'),
    secret,
  );
  if (!ok) return json({ error: 'invalid signature' }, 401);

  let payload: {
    event_id?: string;
    session_id?: string;
    status?: string;
    vendor_data?: string;
    decision?: unknown;
  };
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: 'bad json' }, 400);
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Idempotency: the same event_id is reused on retries and fan-out.
  if (payload.event_id) {
    const { error: insErr } = await admin
      .from('didit_events')
      .insert({ event_id: payload.event_id, session_id: payload.session_id ?? null });
    if (insErr) return json({ received: true, duplicate: true });
  }

  const sessionId = payload.session_id ?? '';
  const diditStatus = String(payload.status ?? '');
  const appStatus = diditToAppStatus(diditStatus);

  const { data: row } = await admin
    .from('verification_requests')
    .select('id, user_id')
    .eq('didit_session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // vendor_data is our profile id — the fallback correlation key.
  const userId = row?.user_id ?? (payload.vendor_data ? Number(payload.vendor_data) : null);
  if (!row && !userId) return json({ received: true });

  if (row) {
    await admin
      .from('verification_requests')
      .update({
        status: appStatus,
        didit_status: diditStatus,
        decision: payload.decision ?? null,
        didit_event_id: payload.event_id ?? null,
      })
      .eq('id', row.id);
  }
  if (userId && appStatus !== 'pending') {
    await admin.from('profiles').update({ verification: appToProfileVerification(appStatus) }).eq('id', userId);
  }

  return json({ received: true });
});
