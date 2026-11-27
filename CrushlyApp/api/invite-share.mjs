// Reusable HolUpp invitation landing. The code is only a referral pointer;
// the database attributes it after the invited account is confirmed and the
// member finishes onboarding. This page never accepts an inviter id from the
// browser and never increments a count on a click.
const SITE = 'https://holupp.net';
const HOSTS = new Set(['holupp.net', 'www.holupp.net', 'mecrushly.vercel.app']);
const CODE = /^[0-9a-f]{32}$/;
const THEME = '#2A0F2B';

const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function validCode(value) {
  return CODE.test(String(value ?? '').trim().toLowerCase());
}

export function originOf(req) {
  const host = String(req?.headers?.host ?? '').toLowerCase().split(':')[0];
  return HOSTS.has(host) ? `https://${host}` : SITE;
}

function signedInRedirect(code, authStorageKey) {
  const safeKey = typeof authStorageKey === 'string' && /^sb-[a-z0-9-]+-auth-token$/.test(authStorageKey) ? authStorageKey : null;
  if (!safeKey) return '';
  return `<script>try{const s=JSON.parse(localStorage.getItem(${JSON.stringify(safeKey)})||'null');if(s&&s.refresh_token)location.replace('/app?ref=${code}')}catch(_){}</script>`;
}

function appLinks(code) {
  return `<p style="margin-top:10px"><a href="holup://invite/${code}" style="color:#FF8788;font-weight:600">Open in the HolUpp app</a></p>`
    + `<p><a href="crushly://invite/${code}" style="color:#C9A7C4;font-size:13px">On an older HolUpp install, open the app instead</a></p>`;
}

const shell = (head, body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="${THEME}">${head}</head>`
  + `<body style="margin:0;background:${THEME};color:#FFF8F8;font:16px system-ui,sans-serif"><main style="max-width:580px;margin:8vh auto;padding:24px">${body}</main></body></html>`;

export function renderInvalidInvite() {
  return shell(
    '<meta name="robots" content="noindex"><title>HolUpp invitation</title>',
    '<a href="/" style="color:#FF8788;font-size:24px;font-weight:800;text-decoration:none">HolUpp</a>'
      + '<article style="margin-top:36px;padding:24px;border:1px solid #71446f;border-radius:22px;background:#35143A"><h1 style="font-size:22px">This invitation is not available</h1><p style="color:#E0CBD4;line-height:1.6">The link may be incomplete or no longer active.</p></article>'
      + '<p style="margin-top:28px"><a href="/" style="display:inline-block;background:#FF8788;color:#2A0F2B;border-radius:14px;padding:14px 22px;font-weight:700;text-decoration:none">Explore HolUpp</a></p>',
  );
}

export function renderInvite(code, inviterName = 'Someone', authStorageKey = null, origin = SITE) {
  const safeCode = String(code).trim().toLowerCase();
  const name = String(inviterName || 'Someone');
  const url = `${origin}/i/${safeCode}`;
  const title = `${name} invited you to HolUpp`;
  const description = `${name} invited you to join HolUpp — your world, your people, your expression.`;
  return shell(
    `<title>${escape(title)}</title><meta name="description" content="${escape(description)}"><meta name="robots" content="noindex, follow">`
      + `<meta property="og:type" content="website"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${escape(url)}"><meta property="og:site_name" content="HolUpp"><meta name="theme-color" content="${THEME}"><meta name="twitter:card" content="summary"><link rel="canonical" href="${escape(url)}">${signedInRedirect(safeCode, authStorageKey)}`,
    `<a href="/" style="color:#FF8788;font-size:24px;font-weight:800;text-decoration:none">HolUpp</a>`
      + `<article style="margin-top:36px;padding:26px;border:1px solid #71446f;border-radius:22px;background:#35143A"><div style="width:58px;height:58px;border-radius:18px;background:#FF8788;color:#2A0F2B;display:flex;align-items:center;justify-content:center;font-size:25px;font-weight:800">H</div><h1 style="font-size:26px;margin:20px 0 8px">${escape(name)} invited you</h1><p style="color:#E0CBD4;line-height:1.65;margin:0">Join HolUpp to share what matters, discover new people and find your place in the network.</p></article>`
      + `<p style="margin-top:28px"><a href="/app?ref=${safeCode}" style="display:inline-block;background:#FF8788;color:#2A0F2B;border-radius:14px;padding:14px 22px;font-weight:700;text-decoration:none">Join HolUpp on the web</a></p>`
      + appLinks(safeCode)
      + `<p style="color:#E0CBD4;font-size:13px;line-height:1.5">Your invitation can be used more than once. A referral is counted only after the new member confirms their account, finishes onboarding and takes a meaningful first step.</p>`,
  );
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).send('Method not allowed');

  const code = String(Array.isArray(req.query.id) ? '' : (req.query.id ?? '')).trim().toLowerCase();
  if (!validCode(code)) return res.status(404).send(req.method === 'HEAD' ? '' : renderInvalidInvite());

  const base = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !key) return res.status(503).send('HolUpp is temporarily unavailable.');

  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/rest/v1/rpc/holup_invite_preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ p_code: code }),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return res.status(503).send('HolUpp is temporarily unavailable.');
    const preview = await response.json();
    const storageKey = `sb-${new URL(base).hostname.split('.')[0]}-auth-token`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (!preview?.valid) return res.status(404).send(req.method === 'HEAD' ? '' : renderInvalidInvite());
    return res.status(200).send(req.method === 'HEAD' ? '' : renderInvite(code, preview.inviterName, storageKey, originOf(req)));
  } catch {
    return res.status(503).send('HolUpp is temporarily unavailable.');
  }
}
