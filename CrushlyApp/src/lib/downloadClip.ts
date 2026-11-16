/**
 * Saving a clip to the device.
 *
 * The rule this module exists to keep: a copy that leaves the app carries the
 * holUpp mark and the creator's handle, and a copy inside the app does not. The
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
import { canSaveClip, clipFileName, isSessionRefused } from './clipSaveRules';
import { saveClipFile } from './saveClipToGallery';
import { mediaDownloadHeaders, refreshMediaSession } from '../api/client';

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
  const url = post.downloadUrl;
  const name = clipFileName(post.id, url);

  /**
   * Somebody else's clip is the one case that has to go to the network.
   *
   * The phone's own posts answer from the marked copy on disk, so they save with
   * no request at all — which is why the report that arrived was specifically
   * "someone else posted a video and I could not download it": that is the only
   * path that talks to the Worker. It needs two things the old call did not
   * guarantee. A token taken from the session *now*, rather than one cached when
   * the app started; and exactly one retry if the Worker still says 401, after
   * forcing a refresh. Anything else — a clip with no copy yet, a post this
   * member may not see — is left to say what it is.
   */
  const attempt = async () => saveClipFile(url, name, post.id, await mediaDownloadHeaders(url));
  try {
    return await attempt();
  } catch (error) {
    if (!isSessionRefused(error)) throw error;
    await refreshMediaSession();
    return attempt();
  }
}
