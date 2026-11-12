/**
 * Keeping a clip on the phone once it has been watched — Android half.
 *
 * Written with `expo-file-system/legacy` on purpose: it is the module the rest of
 * the app already uses for saving clips, so there is one file API in the build
 * rather than two.
 *
 * Three rules this keeps:
 *
 *  · **A cache, not a leak.** Every file is accounted for; once the directory
 *    passes `CACHE_LIMIT_BYTES` the least recently written files go, oldest
 *    first, so a member who watches a hundred clips does not find the app has
 *    eaten their storage. Deleting is explicit and the space is reclaimed.
 *  · **Never blocking.** `cacheClip` is fire-and-forget from the player's point of
 *    view: the clip starts streaming immediately and the second watch is the one
 *    that gets the local file.
 *  · **The token travels with the request, not in the file name.** Media is
 *    behind the Worker's own check; the download carries the same bearer header
 *    the player would have sent.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { CACHE_DIR, CACHE_LIMIT_BYTES, cacheName } from './videoCache';
import { mediaAuthHeaders } from './mediaHost';

const dir = () => `${FileSystem.cacheDirectory ?? ''}${CACHE_DIR}/`;

/** The cache directory, created if this is the first clip. */
async function ensureDir(): Promise<string | null> {
  const base = FileSystem.cacheDirectory;
  if (!base) return null;
  const path = dir();
  const info = await FileSystem.getInfoAsync(path).catch(() => null);
  if (!info?.exists) await FileSystem.makeDirectoryAsync(path, { intermediates: true }).catch(() => undefined);
  return path;
}

/** Total bytes in the cache, and the files, newest first. */
async function inventory(): Promise<{ size: number; files: { uri: string; size: number; modified: number }[] }> {
  const path = await ensureDir();
  if (!path) return { size: 0, files: [] };
  const names = await FileSystem.readDirectoryAsync(path).catch(() => [] as string[]);
  const files: { uri: string; size: number; modified: number }[] = [];
  for (const name of names) {
    const info = await FileSystem.getInfoAsync(`${path}${name}`).catch(() => null);
    if (info?.exists && 'size' in info) {
      files.push({ uri: `${path}${name}`, size: info.size ?? 0, modified: info.modificationTime ?? 0 });
    }
  }
  files.sort((a, b) => b.modified - a.modified);
  return { size: files.reduce((n, f) => n + f.size, 0), files };
}

/** The local copy, if this clip has been watched here before. */
export async function cachedClip(url: string): Promise<string | null> {
  const path = await ensureDir();
  if (!path) return null;
  const target = `${path}${cacheName(url)}`;
  const info = await FileSystem.getInfoAsync(target).catch(() => null);
  return info?.exists && (info.size ?? 0) > 0 ? target : null;
}

/**
 * Download `url` into the cache.
 *
 * Returns the local path, or null when it could not be written — no space, no
 * signal, or a profile with the media store switched off. A cache that fails is
 * not an error the member needs to see: the clip still plays from the network.
 */
export async function cacheClip(url: string): Promise<string | null> {
  const existing = await cachedClip(url);
  if (existing) return existing;
  const path = await ensureDir();
  if (!path) return null;
  const target = `${path}${cacheName(url)}`;
  try {
    const result = await FileSystem.downloadAsync(url, target, { headers: mediaAuthHeaders(url) });
    if (result.status !== 200) {
      await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => undefined);
      return null;
    }
    const info = await FileSystem.getInfoAsync(target).catch(() => null);
    if (!info?.exists || !(info.size ?? 0)) {
      await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => undefined);
      return null;
    }
    await trim();
    return target;
  } catch {
    await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => undefined);
    return null;
  }
}

/**
 * Bring the cache back under its ceiling.
 *
 * Oldest first, and the sizes come from the filesystem rather than from a book
 * kept in memory: a book that drifts is worse than no book, because it makes the
 * cache look smaller than it is.
 */
export async function trim(limit = CACHE_LIMIT_BYTES): Promise<number> {
  const { size, files } = await inventory();
  let remaining = size;
  let removed = 0;
  for (const file of [...files].reverse()) {
    if (remaining <= limit) break;
    await FileSystem.deleteAsync(file.uri, { idempotent: true }).catch(() => undefined);
    remaining -= file.size;
    removed += 1;
  }
  return removed;
}

/** What the cache holds, for a settings screen or a test. */
export async function cacheStats(): Promise<{ files: number; bytes: number }> {
  const { size, files } = await inventory();
  return { files: files.length, bytes: size };
}

export { CACHE_DIR, CACHE_LIMIT_BYTES };
