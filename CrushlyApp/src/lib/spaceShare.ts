/** A Space link contains an ID only; its destination always checks visibility. */
export function spaceShareUrl(id: number): string {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid Space');
  return `https://holupapp.vercel.app/?space=${id}`;
}
export function sharedSpaceId(url: string | null | undefined): number | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!(u.protocol === 'https:' && u.hostname === 'holupapp.vercel.app') &&
        !(u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))) return null;
    const raw = u.searchParams.get('space');
    if (!raw || !/^[1-9][0-9]{0,14}$/.test(raw)) return null;
    const id = Number(raw);
    return Number.isSafeInteger(id) ? id : null;
  } catch { return null; }
}
