// verify-identity — Crushly's AI verification reviewer.
//
// Called by the app after a member submits their pose selfies. Compares the
// live selfie(s) with their profile photos via a vision model and settles the
// verification request in one shot:
//   approved  -> profiles.verification = 'verified'  (badge)
//   rejected  -> profiles.verification = 'rejected'  (they can retake)
//   pending   -> left for human review (no AI key / images missing / AI error)
//
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (all
// automatic for hosted edge functions) + OPENAI_API_KEY (wired from GitHub
// secrets) + optional AI_MODEL (default gpt-4o-mini).

import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MODEL = Deno.env.get('AI_MODEL') || 'gpt-4o-mini';
const MIN_CONFIDENCE = 0.72;

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

  // Who is calling? The app sends the member's access token.
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: who, error: whoErr } = await userClient.auth.getUser();
  const user = who?.user;
  if (whoErr || !user) return json({ error: 'sign in required' }, 401);

  const admin = createClient(url, serviceKey);

  let body: { request_id?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* fall through */
  }
  const requestId = Number(body.request_id ?? 0);
  if (!requestId) return json({ error: 'request_id required' }, 400);

  const { data: request, error: reqErr } = await admin
    .from('verification_requests')
    .select('id, user_id, selfie_path, selfies, pose, status')
    .eq('id', requestId)
    .single();
  if (reqErr || !request) return json({ error: 'request not found' }, 404);

  const { data: profile } = await admin
    .from('profiles')
    .select('id, auth_user_id')
    .eq('id', request.user_id)
    .single();
  if (!profile || profile.auth_user_id !== user.id) return json({ error: 'forbidden' }, 403);

  const settle = async (
    status: 'approved' | 'rejected' | 'pending',
    verdict: Record<string, unknown>,
    reason: string,
  ) => {
    await admin
      .from('verification_requests')
      .update({
        status,
        ai_verdict: verdict,
        ai_reviewed_at: Date.now(),
        reviewed_at: status === 'pending' ? null : Date.now(),
      })
      .eq('id', request.id);
    if (status !== 'pending') {
      await admin
        .from('profiles')
        .update({ verification: status === 'approved' ? 'verified' : 'rejected' })
        .eq('id', request.user_id);
    }
    return json({
      status: status === 'approved' ? 'verified' : status === 'rejected' ? 'rejected' : 'pending',
      reason,
    });
  };

  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    return settle(
      'pending',
      { skipped: 'no-ai-key' },
      'AI review is not configured yet — our team will check your selfie manually.',
    );
  }

  // Collect images: the live selfies (private bucket -> signed URLs) and up to
  // three profile photos (public media bucket).
  const selfiePaths: string[] = [
    String(request.selfie_path ?? ''),
    ...(((request.selfies as string[] | null) ?? []).map(String)),
  ].filter(Boolean);

  const selfieUrls: string[] = [];
  for (const path of selfiePaths) {
    const { data } = await admin.storage.from('verification').createSignedUrl(path, 600);
    if (data?.signedUrl) selfieUrls.push(data.signedUrl);
  }

  const { data: photos } = await admin
    .from('photos')
    .select('url')
    .eq('user_id', request.user_id)
    .order('position')
    .order('id')
    .limit(3);
  const profileUrls = (photos ?? [])
    .map((p) => `${url}/storage/v1/object/public/media/${p.url}`)
    .filter(Boolean);

  if (!selfieUrls.length || !profileUrls.length) {
    return settle(
      'pending',
      { skipped: 'missing-images' },
      'We could not review your photos automatically — our team will take a look.',
    );
  }

  const content: Array<Record<string, unknown>> = [
    {
      type: 'text',
      text:
        `Crushly identity check. Requested pose(s): ${request.pose}.\n` +
        `Images follow: the live verification selfie(s) first, then profile photos.\n` +
        `Judge strictly and answer with ONLY a JSON object:\n` +
        `{\n` +
        `  "real_person": true|false,   // live photo of a real human (false for screens, prints, drawings, statues, masks)\n` +
        `  "pose_ok": true|false,       // the selfie(s) clearly show the requested pose(s)\n` +
        `  "same_person": true|false,   // selfie and profile photos show the SAME person (allow makeup, hairstyle, aging, lighting)\n` +
        `  "confidence": 0.0-1.0,       // confidence that it is the same person\n` +
        `  "reason": "one short, kind sentence for the member"\n` +
        `}`,
    },
  ];
  selfieUrls.forEach((u, i) => {
    content.push({ type: 'text', text: `[selfie ${i + 1}]` });
    content.push({ type: 'image_url', image_url: { url: u } });
  });
  profileUrls.forEach((u, i) => {
    content.push({ type: 'text', text: `[profile ${i + 1}]` });
    content.push({ type: 'image_url', image_url: { url: u } });
  });

  let verdict: Record<string, unknown>;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You are a careful identity-verification assistant for a dating app. You only output JSON.',
          },
          { role: 'user', content },
        ],
      }),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      console.error('openai error', res.status, detail);
      return settle(
        'pending',
        { skipped: 'ai-error', status: res.status },
        'The AI review hit a snag — our team will check your selfie manually.',
      );
    }
    const completion = await res.json();
    verdict = JSON.parse(completion?.choices?.[0]?.message?.content ?? '{}');
  } catch (err) {
    console.error('ai verification failed', err);
    return settle(
      'pending',
      { skipped: 'ai-error' },
      'The AI review hit a snag — our team will check your selfie manually.',
    );
  }

  const same = verdict.same_person === true;
  const real = verdict.real_person === true;
  const pose = verdict.pose_ok === true;
  const confidence = Number(verdict.confidence ?? 0);
  const reason = String(verdict.reason ?? '').slice(0, 300);

  if (same && real && pose && confidence >= MIN_CONFIDENCE) {
    return settle('approved', verdict, reason || 'You’re verified — welcome to the blue check club.');
  }
  return settle(
    'rejected',
    verdict,
    reason || 'The selfie did not match your profile photos clearly enough. Try again in good light.',
  );
});
