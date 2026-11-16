/**
 * Saving a clip — Android side.
 *
 * Fetch the marked copy into the cache, hand it to the gallery, then delete the
 * cache copy: the gallery keeps its own file, and leaving ours behind would keep
 * a second copy of every clip somebody saved.
 *
 * Two things here were failing silently on device, which is why the button read
 * as broken rather than as an error:
 *
 *  · **A 401 was reported as "try again".** The clip URL carries the session
 *    token in its query string, and an expired session therefore looked like a
 *    network problem. Each status now says what actually happened, and a refused
 *    session says so.
 *  · **An empty or truncated file was handed to the gallery.** A download that
 *    produced no bytes is not a saved clip; it is checked before it is given to
 *    the media store, and a failure there names the file rather than calling the
 *    gallery.
 *
 * `Asset.create` is the current API (SDK 54+). The legacy `saveToLibraryAsync` is
 * kept as a second attempt because a device that upgrades the app across a media
 * library version can have one work and not the other, and a retry that quietly
 * succeeds is better than a member seeing "couldn't save" on a clip that could
 * have been saved.
 *
 * Never import this module from anything the web bundle evaluates. It is paired
 * with `saveClipToGallery.ts` (the web half), and Metro resolves the `.native`
 * suffix on device only.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { downloadSource } from './mediaHost';
import { markedCopyFor } from './markedCopy';
import { SaveError, saveMessageFor } from './clipSaveRules';

/**
 * `fresh` is the header the save route measured a moment before the download.
 *
 * `downloadSource` builds headers from the token the media layer cached, and
 * that copy can be an hour old on an app that has been open all day — the Worker
 * answers 401 and the member is told their session expired when it did not. The
 * caller asks the session itself, so the header that arrives here is the current
 * one; anything it does not supply falls back to the cached token as before.
 */
export async function saveClipFile(
  url: string,
  name: string,
  postId?: number,
  fresh?: Record<string, string>,
): Promise<'saved' | 'downloaded' | 'denied'> {
  // `writeOnly` is enough on Android 13+: saving needs no permission to read the
  // gallery, and asking for more than the job needs is a worse prompt.
  const permission = await MediaLibrary.requestPermissionsAsync(true, ['video']);
  if (!permission.granted) return 'denied';

  /*
   * A clip this phone posted already has its marked file here.
   *
   * No request, no filename to trust, and nothing that can fail because of
   * signal or an expired token: the bytes were written on this device a moment
   * after the post went up. Asking the network for a file the phone is holding is
   * a round trip that can only fail, and it did — on mobile data it is exactly
   * how "save" turned into "try again in a minute".
   *
   * When the copy is gone (cache evicted, or somebody else's clip) the download
   * below is the only source, and it stays exactly as it was.
   */
  if (postId) {
    const local = await markedCopyFor(postId);
    if (local) {
      /*
       * The same two-attempt hand-off the download path uses, for the same
       * reason: `Asset.create` is the current API, and a device that upgraded
       * across a media-library version can have one work and not the other.
       * A local file must never be the only attempt, or the fast path becomes a
       * slower failure than the one it replaced.
       */
      try {
        await MediaLibrary.Asset.create(local);
      } catch {
        const legacy = await import('expo-media-library/legacy');
        await legacy.saveToLibraryAsync(local);
      }
      // The gallery owns its own copy now; the cached one has done its job.
      await FileSystem.deleteAsync(local, { idempotent: true }).catch(() => undefined);
      return 'saved';
    }
  }

  /*
   * The URL that arrives here is `/d/<post id>` — a path, not an address — and
   * it needs the member's token or the Worker refuses with 401. Sending the bare
   * path is what produced "Your session has expired" on a session that was
   * perfectly fine: `downloadAsync` was handed something with no host and no
   * Authorization header at all.
   */
  const source = downloadSource(url);
  const address = typeof source === 'string' ? source : source.uri;
  const headers = fresh ?? (typeof source === 'string' ? undefined : source.headers);

  const target = `${FileSystem.cacheDirectory ?? ''}${name}`;
  try {
    const result = await FileSystem.downloadAsync(address, target, headers ? { headers } : undefined);
    // The status is carried, not just the sentence: a 401 is worth one retry with
    // a refreshed session (see `downloadClip`), and a plain Error could not be
    // told apart from a dropped connection.
    if (result.status !== 200) throw new SaveError(result.status, saveMessageFor(result.status));

    const info = await FileSystem.getInfoAsync(target);
    const bytes = info.exists && 'size' in info ? info.size : 0;
    if (!bytes) throw new SaveError(0, 'The clip came back empty. Please try again.');

    try {
      await MediaLibrary.Asset.create(result.uri);
    } catch {
      const legacy = await import('expo-media-library/legacy');
      await legacy.saveToLibraryAsync(result.uri);
    }
    return 'saved';
  } finally {
    await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => undefined);
  }
}
