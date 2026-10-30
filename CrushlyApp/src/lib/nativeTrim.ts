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

/**
 * Rewrite a clip into an MP4 the server will accept, without re-encoding it.
 *
 * A `.mov` from an iPhone or a Samsung gallery is ordinary H.264 inside a
 * QuickTime container. The platform muxer already knows how to pour those same
 * encoded frames into an MP4 container, which is what the trimmer does — so
 * passing the whole clip through it with a full-length range is a remux, not a
 * conversion. It is fast, it does not lose a pixel, and it needs no encoder in
 * the APK.
 *
 * It is not universal. A clip whose codec cannot live in MP4 (some HEVC
 * variants, ProRes) makes the muxer throw. That is reported as `null` rather
 * than an exception: the caller decides what to tell the member, and posting is
 * never blocked by a missing convenience.
 *
 * `durationMs` comes from the picker. A player that reports 0 or nothing is
 * treated as "no remux possible", because a muxer needs a range to copy.
 */
export async function remuxToMp4(uri: string, durationMs: number): Promise<string | null> {
  if (!trimmerAvailable()) return null;
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
  try {
    const { uri: out } = await trimAsync(uri, { startMs: 0, endMs: Math.round(durationMs) });
    return out;
  } catch {
    return null;
  }
}
