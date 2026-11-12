// Public Space landing. Reached only by a token a member minted when they shared,
// never by an id — ids are sequential, so /s/1, /s/2, … would be a member
// directory. Always ask the database, never cache: withdrawing visibility has to
// withdraw the card.
// The canonical site is holupp.net. A card is built for whichever holUpp host
// served it, so a link shared on the old Vercel hostname still advertises the
// address the reader actually has — and a link minted today advertises the
// domain. Anything else in the Host header is ignored.
const SITE = 'https://holupp.net';
const HOSTS = new Set(['holupp.net', 'www.holupp.net', 'holupapp.vercel.app', 'mecrushly.vercel.app']);
/** The origin this request arrived on, if it is one of ours. */
export function originOf(req) {
  const host = String(req?.headers?.host ?? '').toLowerCase().split(':')[0];
  return HOSTS.has(host) ? `https://${host}` : SITE;
}
const CARD_PATH = '/brand/share-card.png';
const CARD_ALT = 'holUpp — where crushes become conversations';
const THEME = '#2A0F2B';
const TOKEN = /^[0-9a-f]{32}$/;
const escape = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);

export function validToken(s) { return TOKEN.test(String(s ?? '').trim().toLowerCase()); }

/** A signed-in visitor goes straight to the Space; everyone else reads the card. */
function signedInRedirect(id, authStorageKey) {
  const safeKey = typeof authStorageKey === 'string' && /^sb-[a-z0-9-]+-auth-token$/.test(authStorageKey) ? authStorageKey : null;
  return safeKey ? `<script>try{const s=JSON.parse(localStorage.getItem(${JSON.stringify(safeKey)})||'null');if(s&&s.refresh_token)location.replace('/?space=${id}')}catch(_){}</script>` : '';
}

// Both installs open links: a secure build answers `holup://`, the older debug one
// only ever registered `crushly://`. Offer the current scheme first and label the
// legacy one honestly.
function appLinks(id) {
  return `<p style="margin-top:10px"><a href="holup://space/${id}" style="color:#FF8788;font-weight:600">Open in the holUpp app</a></p>`
    + `<p><a href="crushly://space/${id}" style="color:#C9A7C4;font-size:13px">On an older holUpp install, open the app instead</a></p>`;
}

const shell = (head, body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="${THEME}">${head}</head>`
  + `<body style="margin:0;background:${THEME};color:#FFF8F8;font:16px system-ui,sans-serif"><main style="max-width:580px;margin:8vh auto;padding:24px">${body}</main></body></html>`;

export function renderUnavailableSpace() {
  return shell(
    `<meta name="robots" content="noindex"><title>holUpp</title>`,
    `<a href="/" style="color:#FF8788;font-size:24px;font-weight:800;text-decoration:none">holUpp</a>`
    + `<article style="margin-top:36px;padding:24px;border:1px solid #71446f;border-radius:22px;background:#35143A"><h1 style="font-size:22px">This Space isn’t available</h1>`
    + `<p style="color:#E0CBD4;line-height:1.6">The link may have been turned off, or the member has changed who can see their Space.</p></article>`
    + `<p style="margin-top:28px"><a href="/" style="display:inline-block;background:#FF8788;color:#2A0F2B;border-radius:14px;padding:14px 22px;font-weight:700;text-decoration:none">Open holUpp</a></p>`,
  );
}

export function renderSpace(space, authStorageKey = null, origin = SITE) {
  const CARD = `${origin}${CARD_PATH}`;
  const id = String(space.id);
  const name = space.name || 'Someone';
  const title = `${name} on holUpp`;
  const bits = [space.username ? `@${space.username}` : null, space.city].filter(Boolean).join(' · ');
  const description = space.bio || (bits ? `${bits}. See their Space on holUpp.` : 'See their Space on holUpp.');
  const url = `${origin}/s/${space.token}`;
  const badge = space.badgeTier === 'diamond' ? ' ◆' : space.badgeTier === 'gold' ? ' ★' : space.verified ? ' ✓' : '';
  const rows = [
    bits ? `<p style="color:#C9A7C4;margin:6px 0 0">${escape(bits)}</p>` : '',
    space.bio ? `<p style="white-space:pre-wrap;line-height:1.6;margin:16px 0 0">${escape(space.bio)}</p>` : '',
  ].join('');
  return shell(
    `<title>${escape(title)}</title><meta name="description" content="${escape(description)}"><meta name="robots" content="noindex, follow">`
    + `<meta property="og:type" content="profile"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}">`
    + `<meta property="og:url" content="${escape(url)}"><meta property="og:site_name" content="holUpp">`
    + `<meta property="og:image" content="${CARD}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">`
    + `<meta property="og:image:alt" content="${escape(CARD_ALT)}">`
    + `<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escape(title)}">`
    + `<meta name="twitter:description" content="${escape(description)}"><meta name="twitter:image" content="${CARD}"><meta name="twitter:image:alt" content="${escape(CARD_ALT)}">`
    + `<link rel="canonical" href="${escape(url)}">${signedInRedirect(id, authStorageKey)}`,
    `<a href="/" style="color:#FF8788;font-size:24px;font-weight:800;text-decoration:none">holUpp</a>`
    + `<article style="margin-top:36px;padding:24px;border:1px solid #71446f;border-radius:22px;background:#35143A">`
    + `<h1 style="font-size:24px;margin:0">${escape(name)}${badge}</h1>${rows}</article>`
    + `<p style="margin-top:28px"><a href="/?space=${id}" style="display:inline-block;background:#FF8788;color:#2A0F2B;border-radius:14px;padding:14px 22px;font-weight:700;text-decoration:none">Open this Space on holUpp web</a></p>`
    + appLinks(id)
    + `<p style="color:#E0CBD4;font-size:13px">You may need to sign in. What you can see follows the member’s current settings.</p>`,
  );
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).send('Method not allowed');
  const token = String((Array.isArray(req.query.id) ? '' : req.query.id) ?? '').trim().toLowerCase();
  if (!validToken(token)) return res.status(404).send('This Space is not available.');
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !key) return res.status(503).send('holUpp is temporarily unavailable.');
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/rest/v1/rpc/public_space_preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ p_token: token }),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return res.status(503).send('holUpp is temporarily unavailable.');
    const space = await response.json();
    const storageKey = `sb-${new URL(base).hostname.split('.')[0]}-auth-token`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (!space || !space.id) return res.status(404).send(req.method === 'HEAD' ? '' : renderUnavailableSpace());
    return res.status(200).send(req.method === 'HEAD' ? '' : renderSpace({ ...space, token }, storageKey, originOf(req)));
  } catch {
    return res.status(503).send('holUpp is temporarily unavailable.');
  }
}
