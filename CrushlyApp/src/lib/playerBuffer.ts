/**
 * How much video a player is allowed to hold, for every clip the app plays.
 *
 * The crash this answers is not a leak — it is a ceiling:
 *
 *   java.lang.OutOfMemoryError: Failed to allocate a 64 byte allocation with
 *   119200 free bytes and 116KB until OOM, target footprint 268435456 …
 *     at androidx.media3.exoplayer.ExoPlayerImplInternal.shouldContinueLoading
 *
 * 268435456 is 256 MB. Media3's loader keeps asking for more data while the
 * default policy says it may, and on a phone recording at a high bitrate the
 * answer fills the Java heap before playback finishes; Android then kills the
 * process, and the member sees the app close.
 *
 * `preferredForwardBufferDuration` alone is a *time* limit, and time is not the
 * thing that runs out — bytes are. At 20 MB/s, four seconds is still 80 MB. So
 * the byte ceiling is the one that matters, and the duration is kept small as
 * well so a slow network does not leave the player reading far ahead of what is
 * being watched.
 *
 * Applied in one place so every player in the app — the editor, a published
 * clip, the blurred backdrop — shares the same ceiling.
 */
import type { BufferOptions } from 'expo-video';

export const CLIP_BUFFER: BufferOptions = {
  /** Seconds of look-ahead. Default is 20, which is several dozen megabytes. */
  preferredForwardBufferDuration: 4,
  /** Hard ceiling on network bytes held for one player. */
  maxBufferBytes: 12 * 1024 * 1024,
  /** Never trade bytes for time: the byte ceiling wins. */
  prioritizeTimeOverSizeThreshold: false,
  /** Enough to start playing, small enough that a seek is not a stall. */
  minBufferForPlayback: 1,
};

type BufferablePlayer = { bufferOptions?: BufferOptions };

/**
 * Best effort by design: a build whose player ignores `bufferOptions` should
 * keep playing exactly as it does today rather than throw while mounting.
 */
export function applyClipBuffer(player: BufferablePlayer | null | undefined): void {
  if (!player) return;
  try {
    player.bufferOptions = CLIP_BUFFER;
  } catch {
    // Nothing to do: the default applies.
  }
}
