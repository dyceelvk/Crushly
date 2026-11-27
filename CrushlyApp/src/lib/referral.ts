import { PUBLIC_SITE, isPublicHost } from './publicSite';

/** Invite codes are opaque UUID-derived values, never member ids or emails. */
export const INVITE_CODE = /^[0-9a-f]{32}$/;

export function invitationUrl(code: string): string {
  const clean = String(code ?? '').trim().toLowerCase();
  if (!INVITE_CODE.test(clean)) throw new Error('Invalid invitation link');
  return `${PUBLIC_SITE}/i/${clean}`;
}

function validCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const clean = decodeURIComponent(raw).trim().toLowerCase();
    return INVITE_CODE.test(clean) ? clean : null;
  } catch {
    return null;
  }
}

/**
 * Read a HolUpp invitation from a browser/App Link without accepting a foreign
 * host or an arbitrary query value. The web fallback uses `/app?ref=...`; the
 * installed app may receive either the HTTPS link or `holup://invite/...`.
 */
export function sharedReferralCode(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol === 'holup:' || u.protocol === 'crushly:') {
      const kind = u.hostname.toLowerCase();
      if (kind !== 'invite' && kind !== 'i') return null;
      return validCode(u.pathname.replace(/^\//, ''));
    }
    const trusted =
      (u.protocol === 'https:' && isPublicHost(u.hostname)) ||
      (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname));
    if (!trusted) return null;
    const pathCode = /^\/i\/([^/]+)\/?$/.exec(u.pathname)?.[1] ?? null;
    return validCode(pathCode || u.searchParams.get('ref'));
  } catch {
    return null;
  }
}
