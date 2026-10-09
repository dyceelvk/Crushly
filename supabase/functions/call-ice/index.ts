// Optional coturn REST credentials: shared secret never reaches the client.
import { createClient } from 'npm:@supabase/supabase-js@2';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return json({ error: 'sign in required' }, 401);
  let channel: unknown;
  try { channel = (await req.json()).channel; } catch { return json({ error: 'call required' }, 400); }
  if (typeof channel !== 'string' || !/^call-[a-f0-9]{32}$/.test(channel)) return json({ error: 'invalid call' }, 400);
  const { data: permitted, error: authError } = await client.rpc('can_join_call', { p_channel: channel });
  if (authError || !permitted) return json({ error: 'call not available' }, 403);
  const iceServers: Record<string, unknown>[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const secret = Deno.env.get('TURN_SHARED_SECRET');
  const urls = (Deno.env.get('TURN_URLS') ?? '').split(',').map(s => s.trim()).filter(s => /^turns?:/.test(s));
  if (secret && urls.length) {
    const username = `${Math.floor(Date.now() / 1000) + 3600}:${user.id}`;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(username)));
    iceServers.push({ urls, username, credential: btoa(String.fromCharCode(...signature)) });
  }
  return json({ iceServers, relayConfigured: iceServers.length > 1 });
});
