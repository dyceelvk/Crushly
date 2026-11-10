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

export async function saveClipFile(url: string, name: string): Promise<'saved' | 'downloaded' | 'denied'> {
  // `writeOnly` is enough on Android 13+: saving needs no permission to read the
  // gallery, and asking for more than the job needs is a worse prompt.
  const permission = await MediaLibrary.requestPermissionsAsync(true, ['video']);
  if (!permission.granted) return 'denied';

  const target = `${FileSystem.cacheDirectory ?? ''}${name}`;
  try {
    const result = await FileSystem.downloadAsync(url, target);
    if (result.status === 401) throw new Error('Your session expired. Sign in again, then save the clip.');
    if (result.status === 404) throw new Error('That clip isn’t available to save.');
    if (result.status !== 200) throw new Error(`The clip could not be downloaded (${result.status}). Please try again.`);

    const info = await FileSystem.getInfoAsync(target);
    const bytes = info.exists && 'size' in info ? info.size : 0;
    if (!bytes) throw new Error('The clip came back empty. Please try again.');

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
