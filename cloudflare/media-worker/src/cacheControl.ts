/** The database decides whether media may be shared in caches. */
export function mediaCacheControl(path: string, cacheable: boolean): string {
  if (!cacheable || path.split('/')[0] === 'messages' || path.split('/')[0] === 'banners') return 'private, no-store';
  if (path.split('/')[0] === 'moments') return 'public, max-age=3600';
  return 'public, max-age=604800';
}
