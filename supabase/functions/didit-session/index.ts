// Legacy verification is paused until the admin-requested review is ready.
// Do not create provider sessions or automatically assign badges here.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: cors });
  return new Response(JSON.stringify({ error: 'Verification is being updated. Please try again later.' }), {
    status: 503, headers: { ...cors, 'Content-Type': 'application/json' },
  });
});
