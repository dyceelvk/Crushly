// didit-status — returns the member's verification state, polling Didit's
// decision endpoint for their latest session. The webhook (didit-webhook) is
// the authoritative push; this is the fallback for when the member returns via
// the Didit callback or taps "Check status".
//
// Secrets: SUPABASE_* (automatic) + DIDIT_API_KEY.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { DIDIT_BASE, diditToAppStatus, appToProfileVerification } from '../_shared/didit.ts';

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

  const { data: row } = await admin
    .from('verification_requests')
    .select('id, didit_session_id, status, didit_status')
    .eq('user_id', profile.id)
    .not('didit_session_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let diditStatus: string | null = row?.didit_status ?? null;

  // Poll Didit while a session is still open.
  const apiKey = Deno.env.get('DIDIT_API_KEY') ?? '';
  if (row?.didit_session_id && row.status === 'pending' && apiKey) {
    try {
      const res = await fetch(`${DIDIT_BASE}/v3/session/${row.didit_session_id}/decision/`, {
        headers: { 'x-api-key': apiKey },
      });
      if (res.ok) {
        const body = await res.json().catch(() => null);
        if (body) {
          // The GET returns the decision at the response root (no .decision wrapper).
          diditStatus = String(body.status ?? body.decision?.status ?? diditStatus);
          const appStatus = diditToAppStatus(diditStatus);
          await admin
            .from('verification_requests')
            .update({ status: appStatus, didit_status: diditStatus, decision: body.decision ?? body })
            .eq('id', row.id);
          await admin.from('profiles').update({ verification: appToProfileVerification(appStatus) }).eq('id', profile.id);
        }
      }
    } catch {
      /* Didit unreachable — fall through with the stored status */
    }
  }

  const { data: fresh } = await admin.from('profiles').select('verification').eq('id', profile.id).maybeSingle();
  return json({
    status: fresh?.verification ?? 'none',
    diditStatus,
    sessionId: row?.didit_session_id ?? null,
  });
});
