// Independent Cloudflare cron for the protected Supabase cleanup worker.
// No applicant data, paths, tokens or provider responses are logged.
const endpoint = 'https://yzcssyebozfkmojqqdhc.supabase.co/functions/v1/manual-evidence-cleanup';

async function run(env) {
  const key = env.CLEANUP_SECRET;
  if (typeof key !== 'string' || key.length < 32 || key.length > 256) throw new Error('Cleanup not configured');
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'x-cleanup-secret': key }, signal: AbortSignal.timeout(100000),
  });
  if (!response.ok) throw new Error('Cleanup request failed');
  const result = await response.json();
  if (!result || result.failed !== 0 || !Number.isSafeInteger(result.removed) || result.removed < 0) {
    throw new Error('Cleanup result invalid');
  }
  return { removed: result.removed, failed: 0 };
}

async function authorized(supplied, expected) {
  if (typeof supplied !== 'string' || typeof expected !== 'string' || supplied.length < 32 || supplied.length > 256 || expected.length < 32 || expected.length > 256) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(supplied)), crypto.subtle.digest('SHA-256', enc.encode(expected))]);
  const aa = new Uint8Array(a), bb = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < aa.length; i++) difference |= aa[i] ^ bb[i];
  return difference === 0;
}

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(run(env)); },
  async fetch(request, env) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/run') return new Response('Not found', { status: 404 });
    if (!await authorized(request.headers.get('x-cleanup-secret'), env.CLEANUP_SECRET)) return new Response('Unauthorized', { status: 401 });
    try {
      return Response.json(await run(env), { headers: { 'cache-control': 'no-store' } });
    } catch {
      return new Response('Cleanup unavailable', { status: 503, headers: { 'cache-control': 'no-store' } });
    }
  },
};
