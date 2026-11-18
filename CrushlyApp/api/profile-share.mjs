// Public Space landing. The profile counterpart of post-share.mjs.
//
// A post link (/v/<id>) has existed for a while; a profile link did not, so the
// only way to send somebody a person was a screenshot of their Space. This is the
// same idea for a member, and it answers with only what that member has already
// agreed a stranger may see — the database decides (public_profile_preview), this
// file only renders the answer.
//
// The handle is in the URL because a handle is public by definition: a member
// chooses it, it appears in their Space, and it can be changed. A sequential id
// never appears, so a link cannot be used to walk the member list.
const SITE = 'https://holupp.net';
const HOSTS = new Set(['holupp.net', 'www.holupp.net', 'mecrushly.vercel.app']);
const CARD_PATH = '/brand/share-card.png';
const THEME = '#2A0F2B';
const HANDLE = /^[a-z0-9_.]{2,30}$/;

const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The origin this request arrived on, if it is one of ours. */
export function originOf(req) {
  const host = String(req?.headers?.host ?? '').toLowerCase().split(':')[0];
  return HOSTS.has(host) ? `https://${host}` : SITE;
}

/**
 * A signed-in reader is sent straight into the app's own Space screen.
 *
 * Without this a member who taps their own profile link lands on a marketing card
 * for an account they are already looking at. The token is read, never written; if
 * it is missing the visitor simply stays on the card.
 */
function signedInRedirect(handle, authStorageKey) {
  const safeKey = typeof authStorageKey === 'string' && /^sb-[a-z0-9-]+-auth-token$/.test(authStorageKey) ? authStorageKey : null;
  if (!safeKey) return '';
  // The handle is not an id, so `?space=` cannot resolve it inside the app. A
  // signed-in reader is handed to the app's own scheme instead, which takes the
  // handle and opens the Space; the card stays exactly as it is.
  return `<script>try{const s=JSON.parse(localStorage.getItem(${JSON.stringify(safeKey)})||'null');if(s&&s.refresh_token)location.replace('holup://space/${encodeURIComponent(handle)}')}catch(_){}</script>`;
}

function appLinks(handle) {
  return `<p style="margin-top:10px"><a href="holup://space/${encodeURIComponent(handle)}" style="color:#FF8788;font-weight:600">Open in the holUpp app</a></p>`
    + `<p><a href="crushly://space/${encodeURIComponent(handle)}" style="color:#C9A7C4;font-size:13px">On an older holUpp install, open the app instead</a></p>`;
}

export function renderUnavailableProfile(handle, authStorageKey = null) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="${THEME}"><meta name="robots" content="noindex"><title>holUpp</title>${signedInRedirect(handle, authStorageKey)}</head><body style="margin:0;background:${THEME};color:#FFF8F8;font:16px system-ui,sans-serif;padding:24px"><h1>This Space is not public</h1><p>This member has not shared their Space with everyone. If you know them, open holUpp and find them there.</p>${appLinks(handle)}<p><a href="/" style="color:#FF8788">Go to holUpp</a></p></body></html>`;
}

export function renderProfile(profile, authStorageKey = null, origin = SITE) {
  const handle = String(profile.username);
  const display = profile.name || `@${handle}`;
  const title = `${display} on holUpp`;
  const bits = [profile.age ? `${profile.age}` : null, profile.city || null].filter(Boolean).join(' · ');
  const description = profile.bio || (bits ? `${bits} — see ${display} on holUpp.` : `See ${display} on holUpp.`);
  const CARD = `${origin}${CARD_PATH}`;
  const url = `${origin}/u/${handle}`;
  const seal = profile.verified
    ? '<span style="display:inline-flex;align-items:center;gap:4px;background:#22c55e1f;color:#4ade80;border-radius:999px;padding:3px 9px;font-size:12px;font-weight:700">✓ Verified</span>'
    : '';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><meta name="description" content="${escape(description)}"><meta name="robots" content="noindex, follow"><meta property="og:type" content="profile"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${escape(url)}"><meta property="og:site_name" content="holUpp"><meta property="og:image" content="${CARD}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="theme-color" content="${THEME}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escape(title)}"><meta name="twitter:description" content="${escape(description)}"><meta name="twitter:image" content="${CARD}"><link rel="canonical" href="${escape(url)}">${signedInRedirect(handle, authStorageKey)}</head><body style="margin:0;background:${THEME};color:#FFF8F8;font:16px system-ui,sans-serif"><main style="max-width:580px;margin:8vh auto;padding:24px"><a href="/" style="color:#FF8788;font-size:24px;font-weight:800;text-decoration:none">holUpp</a><article style="margin-top:36px;padding:26px;border:1px solid #71446f;border-radius:22px;background:#35143A"><div style="display:flex;align-items:center;gap:14px"><div style="width:56px;height:56px;border-radius:50%;background:#FF8788;color:#2A0F2B;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:800">${escape((display[0] || 'h').toUpperCase())}</div><div><h1 style="font-size:22px;margin:0 0 4px">${escape(display)}</h1><div style="color:#C9A7C4;font-size:14px">@${escape(handle)}</div></div></div>${seal ? `<p style="margin:14px 0 0">${seal}</p>` : ''}${bits ? `<p style="margin:12px 0 0;color:#E0CBD4;font-size:14px">${escape(bits)}</p>` : ''}${profile.bio ? `<p style="margin:16px 0 0;white-space:pre-wrap;line-height:1.65">${escape(profile.bio)}</p>` : ''}</article><p style="margin-top:28px"><a href="holup://space/${encodeURIComponent(handle)}" style="display:inline-block;background:#FF8788;color:#2A0F2B;border-radius:14px;padding:14px 22px;font-weight:700;text-decoration:none">Open this Space in holUpp</a></p><p style="margin-top:10px"><a href="crushly://space/${encodeURIComponent(handle)}" style="color:#C9A7C4;font-size:13px">On an older holUpp install, open the app instead</a></p><p style="margin-top:18px"><a href="/" style="color:#FF8788">Not on the app yet? Get holUpp</a></p><p style="color:#E0CBD4;font-size:13px">What you see follows this member's current privacy settings.</p></main></body></html>`;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).send('Method not allowed');

  const handle = String(Array.isArray(req.query.id) ? '' : (req.query.id ?? '')).toLowerCase();
  if (!HANDLE.test(handle)) return res.status(404).send('This Space is not available.');

  const base = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !key) return res.status(503).send('holUpp is temporarily unavailable.');

  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/rest/v1/rpc/public_profile_preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ p_username: handle }),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return res.status(503).send('holUpp is temporarily unavailable.');
    const profile = await response.json();
    const storageKey = `sb-${new URL(base).hostname.split('.')[0]}-auth-token`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // A missing profile and a private profile answer identically, on purpose: an
    // unknown handle must not be distinguishable from a hidden one.
    if (!profile || String(profile.username).toLowerCase() !== handle) {
      return res.status(404).send(req.method === 'HEAD' ? '' : renderUnavailableProfile(handle, storageKey));
    }
    return res.status(200).send(req.method === 'HEAD' ? '' : renderProfile(profile, storageKey, originOf(req)));
  } catch {
    return res.status(503).send('holUpp is temporarily unavailable.');
  }
}
