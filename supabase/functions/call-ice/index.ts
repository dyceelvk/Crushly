// Where the two ends of a call meet.
//
// A call needs somewhere for the audio to go. STUN tells each phone the address
// the internet sees it at, which is enough when both people are on ordinary home
// broadband — and is not enough on a mobile network, where the carrier puts
// thousands of subscribers behind one address and neither phone can be reached
// from outside. That is the normal case here, so a call with STUN alone rings,
// connects the signal, and then carries no sound.
//
// So a relay: Cloudflare TURN, minted per call and short-lived, with the API
// token never leaving this function. static coturn credentials are still
// supported for anybody running their own, because a relay you own is better
// than a relay you rent.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

type Ice = { urls: string | string[]; username?: string; credential?: string };

const STUN: Ice[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

/**
 * Cloudflare's TURN service hands out credentials that live for a few minutes.
 *
 * The key id and token are the account's; they stay in the function's
 * environment and the browser only ever sees the throwaway username and
 * password minted from them.
 */
async function cloudflareTurn(ttlSeconds = 3600): Promise<Ice | null> {
  const keyId = Deno.env.get('CF_TURN_KEY_ID');
  const token = Deno.env.get('CF_TURN_API_TOKEN');
  if (!keyId || !token) return null;
  try {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: ttlSeconds }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const servers = data?.iceServers;
    return servers && servers.urls ? (servers as Ice) : null;
  } catch {
    return null;
  }
}

/** coturn's REST credentials: a username with an expiry, signed with a shared secret. */
async function coturnRest(userId: string): Promise<Ice | null> {
  const secret = Deno.env.get('TURN_SHARED_SECRET');
  const urls = (Deno.env.get('TURN_URLS') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^turns?:/.test(s));
  if (!secret || !urls.length) return null;
  const username = `${Math.floor(Date.now() / 1000) + 3600}:${userId}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(username)));
  return { urls, username, credential: btoa(String.fromCharCode(...signature)) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return json({ error: 'sign in required' }, 401);

  let channel: unknown;
  try {
    channel = (await req.json()).channel;
  } catch {
    return json({ error: 'call required' }, 400);
  }
  if (typeof channel !== 'string' || !/^call-[a-f0-9]{32}$/.test(channel)) return json({ error: 'invalid call' }, 400);

  // Only the two people in the call may be handed relay credentials: this is
  // what stops the endpoint being used as a free proxy by anybody signed in.
  const { data: permitted, error: authError } = await client.rpc('can_join_call', { p_channel: channel });
  if (authError || !permitted) return json({ error: 'call not available' }, 403);

  const relay = (await cloudflareTurn()) ?? (await coturnRest(user.id));
  const iceServers = relay ? [STUN[0], relay] : STUN;
  return json({ iceServers, relayConfigured: !!relay });
});
