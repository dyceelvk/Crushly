// didit-status — returns the member's verification state, polling Didit's
// decision endpoint for their latest session. The webhook (didit-webhook) is
// the authoritative push; this is the fallback for when the member returns via
// the Didit callback or taps "Check status".
//
// Secrets: SUPABASE_* (automatic) + DIDIT_API_KEY.

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

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
    .select('id, verification')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (profErr || !profile) return json({ error: 'profile not found' }, 404);

  const { data: row, error: rowErr } = await admin
    .from('verification_requests')
    .select('id, didit_session_id, status, didit_status')
    .eq('user_id', profile.id)
    .not('didit_session_id', 'is', null)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (rowErr) return json({ error: 'Couldn’t look up your verification status. Please try again.' }, 500);

  let providerStatus = row?.didit_status ?? null;
  let decision: unknown = null;
  const apiKey = Deno.env.get('DIDIT_API_KEY') ?? '';
  if (row?.didit_session_id && row.status === 'pending' && apiKey) {
    try {
      const res = await fetch(`${DIDIT_BASE}/v3/session/${row.didit_session_id}/decision/`, {
        headers: { 'x-api-key': apiKey },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const body = await res.json();
        providerStatus = body.status ?? body.decision?.status ?? providerStatus;
        decision = body.decision ?? body;
      }
    } catch {
      // A temporarily unavailable provider does not change a stored decision.
    }
  }
  if (row?.didit_session_id && providerStatus) {
    const { error } = await admin.rpc('apply_didit_status', {
      p_session_id: row.didit_session_id, p_status: providerStatus, p_decision: decision,
    });
    if (error) return json({ error: 'Couldn’t save your verification status. Please try again.' }, 500);
  }

  // Return database truth, not a stale poll or a callback URL's claimed result.
  const { data: fresh, error: freshErr } = await admin.from('profiles').select('verification').eq('id', profile.id).single();
  const { data: latest, error: latestErr } = await admin.from('verification_requests')
    .select('didit_status, didit_session_id').eq('user_id', profile.id)
    .not('didit_session_id', 'is', null).order('id', { ascending: false }).limit(1).maybeSingle();
  if (freshErr || latestErr) return json({ error: 'Couldn’t load your verification status.' }, 500);
  return json({
    status: fresh.verification,
    diditStatus: latest?.didit_status ?? null,
    sessionId: latest?.didit_session_id ?? null,
  });
});
