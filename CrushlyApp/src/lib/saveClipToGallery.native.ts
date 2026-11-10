/**
 * Saving a clip — Android side.
 *
 * Fetch the marked copy into the cache, hand it to the gallery, then delete the
 * cache copy: the gallery keeps its own file, and leaving ours behind would keep
 * a second copy of every clip somebody saved.
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
    if (result.status !== 200) throw new Error('The clip could not be downloaded. Please try again.');
    await MediaLibrary.Asset.create(result.uri);
    return 'saved';
  } finally {
    await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => undefined);
  }
}
