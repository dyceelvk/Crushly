// didit-webhook — receives Didit's signed webhooks and settles the member's
// verification. No JWT on this function (config.toml: verify_jwt = false):
// Didit calls it, and the X-Signature-V2 HMAC is the authentication.
//
// Verify the signature over the RAW body BEFORE parsing, dedupe on event_id
// (Didit reuses it across retries), then map the decision onto the member.
//
// Secrets: SUPABASE_* (automatic) + DIDIT_WEBHOOK_SECRET.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyDiditWebhook } from '../_shared/didit.ts';

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

  if (!payload.session_id || !payload.status) return json({ error: 'session_id and status required' }, 400);
  const { error } = await admin.rpc('apply_didit_status', {
    p_session_id: payload.session_id,
    p_status: payload.status,
    p_decision: payload.decision ?? null,
    p_event_id: payload.event_id ?? null,
  });
  // A failing transaction leaves the event retryable (including a webhook that
  // arrives before the create-session response has been recorded).
  if (error) return json({ error: 'Couldn’t save the verification update. Please retry.' }, 503);
  return json({ received: true });
});
