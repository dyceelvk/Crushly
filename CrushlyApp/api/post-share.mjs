// Public share landing. Always fetch current public visibility; never expose a
// protected media URL or cache a post that could later be made private.
const SITE = 'https://holupapp.vercel.app';
const escape = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
export function validId(s) { return /^[1-9][0-9]{0,14}$/.test(String(s ?? '')) && Number.isSafeInteger(Number(s)); }
function signedInRedirect(id, authStorageKey) {
  const safeKey = typeof authStorageKey === 'string' && /^sb-[a-z0-9-]+-auth-token$/.test(authStorageKey) ? authStorageKey : null;
  return safeKey ? `<script>try{const s=JSON.parse(localStorage.getItem(${JSON.stringify(safeKey)})||'null');if(s&&s.refresh_token)location.replace('/?post=${id}')}catch(_){}</script>` : '';
}
export function renderUnavailableShare(id, authStorageKey = null) {
  if (!validId(id)) return 'This post is not available.';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Holup</title>${signedInRedirect(id, authStorageKey)}</head><body style="background:#2A0F2B;color:#FFF8F8;font:16px system-ui,sans-serif;padding:24px"><h1>Open in Holup</h1><p>This post may not be available to everyone. Sign in to check.</p><p><a href="crushly://v/${id}" style="color:#FF8788">Open in the Holup app</a></p><p><a href="/?post=${id}" style="color:#FF8788">Continue on Holup web</a></p></body></html>`;
}
export function renderShare(post, authStorageKey = null) {
  const id = String(post.id);
  const title = `${post.author || 'Someone'} on Holup`;
  const description = post.body?.trim() || 'See this post on Holup.';
  const url = `${SITE}/v/${id}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><meta name="description" content="${escape(description)}"><meta property="og:type" content="article"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${escape(url)}"><meta property="og:image" content="${SITE}/brand/share-card.png"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escape(title)}"><meta name="twitter:description" content="${escape(description)}"><meta name="twitter:image" content="${SITE}/brand/share-card.png"><link rel="canonical" href="${escape(url)}">${signedInRedirect(id, authStorageKey)}</head><body style="margin:0;background:#2A0F2B;color:#FFF8F8;font:16px system-ui,sans-serif"><main style="max-width:580px;margin:8vh auto;padding:24px"><a href="/" style="color:#FF8788;font-size:24px;font-weight:800;text-decoration:none">Holup</a><article style="margin-top:36px;padding:24px;border:1px solid #71446f;border-radius:22px;background:#35143A"><h1 style="font-size:22px">${escape(title)}</h1><p style="white-space:pre-wrap;line-height:1.6">${escape(description)}</p></article><p style="margin-top:28px"><a href="/?post=${id}" style="display:inline-block;background:#FF8788;color:#2A0F2B;border-radius:14px;padding:14px 22px;font-weight:700;text-decoration:none">Open in Holup web</a></p><p><a href="crushly://v/${id}" style="color:#FF8788">Open in the Holup app</a></p><p style="color:#E0CBD4;font-size:13px">You may need to sign in. Access follows the author's current settings.</p></main></body></html>`;
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).send('Method not allowed');
  const id = Array.isArray(req.query.id) ? '' : req.query.id;
  if (!validId(id)) return res.status(404).send('This post is not available.');
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !key) return res.status(503).send('Holup is temporarily unavailable.');
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/rest/v1/rpc/public_post_preview`, {
      method:'POST', headers:{'Content-Type':'application/json', apikey:key, Authorization:`Bearer ${key}`}, body:JSON.stringify({p_post_id:Number(id)}), cache:'no-store', signal:AbortSignal.timeout(8000),
    });
    if (!response.ok) return res.status(503).send('Holup is temporarily unavailable.');
    const post = await response.json();
    const storageKey = `sb-${new URL(base).hostname.split('.')[0]}-auth-token`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (!post || String(post.id) !== String(id)) return res.status(404).send(req.method === 'HEAD' ? '' : renderUnavailableShare(id, storageKey));
    return res.status(200).send(req.method === 'HEAD' ? '' : renderShare(post, storageKey));
  } catch {
    return res.status(503).send('Holup is temporarily unavailable.');
  }
}
