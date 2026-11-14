/**
 * The copy of a clip that the app is allowed to touch.
 *
 * A phone camera clip is routinely 100–300 MB. Everything downstream of the
 * picker — the trim screen's player, the editor's filters and overlays, the
 * mark step — used to work on that original file. Playing it through Media3
 * while the encoder's buffers and the app's own bitmaps were also live is what
 * left the process at the 256 MB heap cap:
 *
 *   java.lang.OutOfMemoryError … target footprint 268435456
 *     at androidx.media3.exoplayer.ExoPlayerImplInternal.shouldContinueLoading
 *
 * and Android killed the app. Raising the heap (`android:largeHeap`) and
 * capping the player's buffer both help, but neither changes the fact that the
 * editor is being asked to hold a file the phone never needed to hold.
 *
 * So the file is made smaller once, immediately after it is picked, *before*
 * anything opens it:
 *
 *   pick → compress on device → work on the small copy → upload the small copy
 *
 * The original is never modified and never deleted — if the encode fails, the
 * clip the member picked is used exactly as before. On the web there is no
 * native encoder, a Blob already lives in memory and the browser does not copy
 * it, so this is a no-op there (`compressVideoFile` returns null).
 *
 * The thresholds are not restated here: `planUpload` owns them, so the number
 * that decides "this needs shrinking before the editor sees it" is the same
 * number that decides it before upload, and there is one place to change.
 */
import { Platform } from 'react-native';
import { compressVideoFile, fileSize, type CompressProgress } from './compressVideo';
import { LEAVE_ALONE_BYTES, UPLOAD_TARGET_BYTES } from './uploadPlan';
import { notePreparedCopy } from './workingCopies';

export type WorkingCopy = {
  /** What to hand to the editor, the player and the upload. */
  uri: string;
  bytes: number | null;
  /** True when this is a re-encoded copy rather than the member's own file. */
  compressed: boolean;
};

/**
 * Never rejects: a phone that cannot encode gets its own clip back, unchanged,
 * and the screens behave exactly as they did before this existed.
 */
export async function makeClipWorkingCopy(
  uri: string,
  progress?: CompressProgress,
): Promise<WorkingCopy> {
  if (Platform.OS === 'web') return { uri, bytes: null, compressed: false };

  const bytes = await fileSize(uri).catch(() => null);
  // Unmeasurable is treated as small: guessing "big" would mean encoding a clip
  // we cannot even read, and the editor copes with small files.
  if (bytes !== null && bytes <= LEAVE_ALONE_BYTES) return { uri, bytes, compressed: false };

  const smaller = await compressVideoFile(uri, UPLOAD_TARGET_BYTES, progress).catch(() => null);
  if (!smaller?.uri || smaller.uri === uri) return { uri, bytes, compressed: false };

  notePreparedCopy(smaller.uri);
  return { uri: smaller.uri, bytes: smaller.bytes ?? bytes, compressed: true };
}
