// RielAi member help assistant.
//
// This release is intentionally help-only. It answers from this approved,
// versioned product knowledge base; it does not call the administrator AI
// provider, read member tables, persist a conversation, or expose credentials.

import { createClient } from 'npm:@supabase/supabase-js@2';

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

const ARTICLES = [
  {
    topic: 'connections',
    terms: ['add up', 'add back', 'connection', 'crush', 'big up'],
    answer: 'An Add Up is how you say “I’m here.” If they add back, you become Connections and can start talking. A Big Up is an Add Up with a note that appears at the top of their Add Ups; you get three a day.',
  },
  {
    topic: 'messaging',
    terms: ['whisper', 'message', 'chat', 'talk', 'who can message'],
    answer: 'By default, only people who added back can Whisper you. You can change who can reach you in Settings, then Privacy & visibility. Your Whispers stay private between the people in that conversation.',
  },
  {
    topic: 'verification',
    terms: ['verify', 'verification', 'didit', 'identity', 'badge', 'id'],
    answer: 'Open Settings and choose Verification, then tap “Verify with Didit”. Didit captures a live selfie and checks your identity document. holUpp receives the verification outcome, not your document image. Opening the check does not submit anything on its own.',
  },
  {
    topic: 'moments',
    terms: ['moment', '24 hours', 'disappear', 'reply'],
    answer: 'Moments are short-lived posts with a photo or a few words. They disappear after 24 hours, and replies arrive as private Whispers.',
  },
  {
    topic: 'privacy',
    terms: ['privacy', 'location', 'distance', 'hide', 'pause', 'discover', 'online', 'email'],
    answer: 'Your exact location is not shared; members see a rounded distance at most. Use Settings → Privacy & visibility to manage discovery, distance, online status, and who can reach you. Settings → Account & security includes account controls.',
  },
  {
    topic: 'safety',
    terms: ['safe', 'safety', 'scam', 'money', 'harass', 'threat', 'report', 'flag', 'block', 'cut off'],
    answer: 'If someone makes you uncomfortable, open their Space or Whisper menu and choose Cut Off or Flag. Flags are confidential and reviewed by a person. Never send money, passwords, one-time codes, or financial details. If you are in immediate danger, contact local emergency services first.',
  },
  {
    topic: 'account',
    terms: ['password', 'sign in', 'login', 'account', 'delete', 'email', 'change'],
    answer: 'Use Settings → Account & security for password, email, and account controls. If you cannot sign in, use “Forgot password” on the sign-in screen. Do not share a password or one-time code with anyone claiming to be support.',
  },
  {
    topic: 'notifications',
    terms: ['notification', 'push', 'announcement', 'email update', 'alert'],
    answer: 'Open Settings → Notification settings to choose your activity alerts and HolUpp announcement channels. Push alerts also depend on permission being enabled on your device. Service and safety messages may still be necessary to keep your account secure.',
  },
  {
    topic: 'support',
    terms: ['bug', 'problem', 'broken', 'not working', 'help', 'support', 'issue', 'error'],
    answer: 'Tell me what you expected and what happened. If the steps below do not solve it, tap “Report a problem” and send the support team a short subject plus the details. RielAi does not save a hidden chat; only a report you explicitly submit is kept for support.',
  },
];

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!authHeader || !url || !anon) return json({ error: 'sign in required' }, 401);
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: who, error: whoErr } = await userClient.auth.getUser();
  if (whoErr || !who.user) return json({ error: 'sign in required' }, 401);

  const input = await req.json().catch(() => null) as { question?: unknown } | null;
  const question = typeof input?.question === 'string' ? input.question.split(String.fromCharCode(0)).join('').trim().slice(0, 2000) : '';
  if (question.length < 2) return json({ error: 'Write a question first.' }, 400);

  const text = normalize(question);
  const scored = ARTICLES.map((article) => {
    const score = article.terms.reduce((sum, term) => sum + (text.includes(normalize(term)) ? (term.includes(' ') ? 3 : 2) : 0), 0);
    return { article, score };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0];
  const safety = ['safety', 'scam', 'money', 'threat', 'harass', 'report', 'flag', 'danger'].some((term) => text.includes(term));
  const lowConfidence = !best || best.score < 2;
  const answer = lowConfidence
    ? 'I can help with holUpp features, privacy, verification, safety, notifications, account settings, and reporting a problem. Try asking one of those in a little more detail, or tap “Report a problem” to send the support team your description.'
    : best.article.answer;

  return json({
    answer,
    suggestReport: safety || lowConfidence || best.article.topic === 'support',
    topic: lowConfidence ? 'support' : best.article.topic,
  });
});
