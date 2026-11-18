import { PUBLIC_SITE, isPublicHost } from './publicSite';

/**
 * A Space's public link: `https://holupp.net/u/<handle>`.
 *
 * The handle, not the id. Ids are sequential, so `/u/41` links would let anyone
 * walk the member list; a handle is public on purpose — the member chose it, it
 * is already on their Space, and they can change it. The landing page asks the
 * database whether that handle may be shown to a stranger, so a private Space
 * and an unknown handle answer the same way.
 */
const HANDLE = /^[a-z0-9_.]{2,30}$/;

export function profileShareUrl(username: string): string {
  const handle = String(username ?? '').trim().toLowerCase().replace(/^@/, '');
  if (!HANDLE.test(handle)) throw new Error('This Space needs a handle before it can be shared');
  return `${PUBLIC_SITE}/u/${handle}`;
}

/** Reading the other direction: does this link point at a Space, and whose? */
export function sharedProfile(usernameFromUrl: string | null | undefined): string | null {
  if (!usernameFromUrl) return null;
  try {
    const url = new URL(usernameFromUrl);
    if ((url.protocol === 'holup:' || url.protocol === 'crushly:') && url.hostname === 'space') {
      const handle = decodeURIComponent(url.pathname.replace(/^\//, '')).toLowerCase();
      return HANDLE.test(handle) ? handle : null;
    }
    if (url.protocol === 'https:' && isPublicHost(url.hostname)) {
      const handle = (/^\/u\/([^/]+)\/?$/.exec(url.pathname)?.[1] ?? '').toLowerCase();
      return HANDLE.test(handle) ? handle : null;
    }
    return null;
  } catch {
    return null;
  }
}
