/**
 * Saving a clip to the phone's own gallery.
 *
 * The rule this module exists to keep: a copy that leaves the app carries the
 * Holup mark and the creator's handle, and a copy inside the app does not. The
 * mark is not drawn here — it is burnt into the file once by the media pipeline
 * (`scripts/mark-clip.py`) and served as a separate variant. Burning it on the
 * device would mean shipping a video encoder to every phone, and re-encoding a
 * clip to draw a corner stamp loses quality on something the creator already
 * uploaded.
 *
 * Which file may be saved is decided in `clipSaveRules`, where it can be tested
 * without a phone.
 */
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { canSaveClip, clipFileName } from './clipSaveRules';

export { canSaveClip, clipFileName };
export type { SaveablePost } from './clipSaveRules';

export type SaveOutcome =
  | 'saved'          // written to the device gallery
  | 'downloaded'     // web: handed to the browser's downloads
  | 'denied'         // the member said no to gallery access; nothing was written
  | 'unavailable';   // no marked copy exists for this post

/**
 * Fetch the marked copy into the cache, hand it to the gallery, then delete the
 * cache copy. The gallery keeps its own file; leaving ours behind would keep a
 * second copy of every clip somebody saved.
 */
async function saveOnDevice(url: string, name: string): Promise<SaveOutcome> {
  // `writeOnly` is enough on Android 13+: saving needs no permission to read the
  // gallery, and asking for one would be a worse prompt for a smaller need.
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

/**
 * Web has no gallery, so the browser's download is the honest equivalent: the
 * same marked file, named the same way, landing where the member expects.
 */
function saveInBrowser(url: string, name: string): SaveOutcome {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return 'downloaded';
}

export async function saveClipToDevice(post: {
  id: number;
  mediaKind?: string | null;
  downloadUrl?: string | null;
}): Promise<SaveOutcome> {
  if (!canSaveClip(post) || !post.downloadUrl) return 'unavailable';
  const name = clipFileName(post.id, post.downloadUrl);
  return Platform.OS === 'web' ? saveInBrowser(post.downloadUrl, name) : saveOnDevice(post.downloadUrl, name);
}
