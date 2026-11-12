/**
 * Keeping a clip on the phone once it has been watched.
 *
 * A feed that re-downloads the same ten-second clip every time it scrolls back
 * is a feed that stutters on a bus. The phone already has a disk; the only thing
 * missing was somebody deciding to use it. So a clip that has been played once is
 * written into the app's cache directory under a name derived from its URL, and
 * the player is handed the local file from then on — which is faster, works with
 * no signal, and costs nothing to repeat.
 *
 * This is the web half. A browser has its own cache and its own rules; trying to
 * out-engineer it from JavaScript would store the same bytes twice.
 */
export const CACHE_DIR = 'video-cache';
/** What one phone may spend on clips. Beyond this, the oldest go first. */
export const CACHE_LIMIT_BYTES = 400 * 1024 * 1024;

/** Nothing to do on the web: the browser caches what it plays. */
export async function cacheClip(_url: string): Promise<string | null> {
  return null;
}

/** The already-cached copy of `url`, or null if it has never been played here. */
export async function cachedClip(_url: string): Promise<string | null> {
  return null;
}

/** A name for a URL that is safe on a filesystem and stable across launches. */
export function cacheName(url: string): string {
  let hash = 5381;
  for (let i = 0; i < url.length; i += 1) hash = ((hash << 5) + hash + url.charCodeAt(i)) >>> 0;
  const ext = /\.(mp4|mov|m4v|webm)(?:\?|#|$)/i.exec(url)?.[1]?.toLowerCase() ?? 'mp4';
  return `${hash.toString(36)}.${ext}`;
}
