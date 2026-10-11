/**
 * The one edit that has to happen to the file itself: the cut.
 *
 * Everything else in the editor — captions, stickers — travels as data and is
 * drawn by the player. A cut cannot. If a clip is trimmed from a minute to
 * fifteen seconds but the whole minute is still uploaded, the trim was a lie:
 * nobody's storage or bandwidth was spared, and the part that was cut away is
 * sitting in the bucket for anyone who fetches the file directly.
 *
 * So the cut is applied to the file, on the phone, before upload.
 *
 * It is done by stream-copying the encoded frames rather than re-encoding them.
 * That choice is deliberate and it buys four things at once:
 *
 *   - The file really does get smaller — fewer frames, fewer bytes.
 *   - It is near-instant, because nothing is decoded or re-compressed.
 *   - Quality is untouched: not one pixel is re-compressed.
 *   - It adds no binary weight, because the codec is the one the phone
 *     already ships. Bundling an encoder instead would put tens of megabytes
 *     into the APK and re-compress every clip.
 *
 * The trade is that on Android the cut begins at the nearest keyframe at or
 * before the requested start, so the head of the clip can be up to about a
 * second or two long. A frame-exact cut would require re-encoding the leading
 * group of pictures, which is exactly the cost this avoids.
 */

import { Platform } from 'react-native';
import { isAvailable as nativeIsAvailable, trimAsync } from 'react-native-lossless-trim';

/** The range to keep, in milliseconds. */
export type TrimRange = { startMs: number; endMs: number };

/**
 * Whether the phone can cut a clip right now.
 *
 * False on the web and in Expo Go, where there is no native module. Callers
 * must treat that as "keep the whole file" rather than as an error — posting
 * must never be blocked by this.
 */
export function trimmerAvailable(): boolean {
  return Platform.OS !== 'web' && nativeIsAvailable();
}

/** Cut `range` out of `uri` and resolve with a uri to the shorter file. */
export async function trimVideo(uri: string, range: TrimRange): Promise<string> {
  if (!trimmerAvailable()) throw new Error('No trimmer in this build.');

  const startMs = Math.max(0, Math.round(range.startMs));
  // A zero-length range is rejected by the module and would mean nothing anyway.
  const endMs = Math.max(startMs + 100, Math.round(range.endMs));

  const { uri: out } = await trimAsync(uri, { startMs, endMs });
  return out;
}
