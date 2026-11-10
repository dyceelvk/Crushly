/** One canonical URL for external sharing; no post text or media in the URL. */
export function postShareUrl(id: number): string {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid post');
  return `https://holupapp.vercel.app/v/${id}`;
}
export function sharedPostId(url: string | null | undefined): number | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    let raw: string | null = null;
    // Two schemes exist: `holup` is the secure build, `crushly` the older one.
    // Both are ours, so both resolve to the same post id and nothing else is
    // accepted as a holUpp link.
    if ((u.protocol === 'holup:' || u.protocol === 'crushly:') && u.hostname === 'v') raw = u.pathname.slice(1);
    else if (u.protocol === 'https:' && ['holupapp.vercel.app', 'mecrushly.vercel.app'].includes(u.hostname)) raw = /^\/v\/([0-9]+)\/?$/.exec(u.pathname)?.[1] ?? u.searchParams.get('post');
    else if (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)) raw = u.searchParams.get('post');
    if (!raw || !/^[1-9][0-9]{0,14}$/.test(raw)) return null;
    const id = Number(raw);
    return Number.isSafeInteger(id) ? id : null;
  } catch { return null; }
}
