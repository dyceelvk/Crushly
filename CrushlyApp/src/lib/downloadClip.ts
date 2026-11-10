/**
 * Saving a clip to the device.
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
 * without a phone. How it is saved is decided per platform in
 * `saveClipToGallery` — that split is not tidiness: `expo-media-library` throws
 * while being *imported* on web, so importing it here would take the whole web
 * app down to a white screen. It did, once.
 */
import { canSaveClip, clipFileName } from './clipSaveRules';
import { saveClipFile } from './saveClipToGallery';

export { canSaveClip, clipFileName };
export type { SaveablePost } from './clipSaveRules';

export type SaveOutcome =
  | 'saved'          // written to the device gallery
  | 'downloaded'     // web: handed to the browser's downloads
  | 'denied'         // the member said no to gallery access; nothing was written
  | 'unavailable';   // no marked copy exists for this post

export async function saveClipToDevice(post: {
  id: number;
  mediaKind?: string | null;
  downloadUrl?: string | null;
}): Promise<SaveOutcome> {
  if (!canSaveClip(post) || !post.downloadUrl) return 'unavailable';
  return saveClipFile(post.downloadUrl, clipFileName(post.id, post.downloadUrl));
}
