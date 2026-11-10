/**
 * A Space link carries an unguessable token, never the member's id.
 *
 * Ids are sequential, so `/s/41` style links would let anyone walk the member
 * list. The token is minted by the database when a member taps share, can be
 * revoked, and is what the landing page exchanges for a name card.
 */
const TOKEN = /^[0-9a-f]{32}$/;

export function spaceShareUrl(token: string): string {
  const clean = String(token ?? '').trim().toLowerCase();
  if (!TOKEN.test(clean)) throw new Error('Invalid Space link');
  return `https://holupapp.vercel.app/s/${clean}`;
}

/**
 * Where a Holup link is asking to go. Three shapes are accepted:
 *
 *   ?space=<id>      the legacy web shape, still in circulation in old shares
 *   /s/<token>       the current share shape; the landing page hands over the id
 *   holup://space/<id>  the app scheme, so a link can open the app directly
 *
 * Anything else — a foreign host, a lookalike scheme, a malformed id — is null,
 * because the destination screen checks visibility again anyway and a wrong
 * parse would only take somebody somewhere they cannot see.
 */
export function sharedSpaceId(url: string | null | undefined): number | null {
  if (!url) return null;
  const id = (raw: string | null) => {
    if (!raw || !/^[1-9][0-9]{0,14}$/.test(raw)) return null;
    const n = Number(raw);
    return Number.isSafeInteger(n) ? n : null;
  };
  try {
    const u = new URL(url);
    if (u.protocol === 'holup:' || u.protocol === 'crushly:') {
      // URL puts everything after the scheme in pathname for unknown schemes.
      const path = `${u.hostname}${u.pathname}`.replace(/^\/+/, '');
      const m = /^space\/(\d+)$/.exec(path);
      return m ? id(m[1]) : null;
    }
    const trusted =
      (u.protocol === 'https:' && u.hostname === 'holupapp.vercel.app') ||
      (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname));
    if (!trusted) return null;
    const fromQuery = id(u.searchParams.get('space'));
    if (fromQuery) return fromQuery;
    // /s/<token> is not resolvable in the app: the token is exchanged for an id
    // by the landing page, which then links on to ?space=<id>.
    return null;
  } catch {
    return null;
  }
}
