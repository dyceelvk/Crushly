/**
 * Which copy of a clip gets the mark — and the rule that makes it always the
 * small one.
 *
 * This file exists because of a force-close. Posting a big clip ran three
 * full transcodes back to back on the phone:
 *
 *   1. `uploadMediaFile` compressed the picked file (200 MB -> ~60 MB) and
 *      uploaded it. This part was already made memory-safe.
 *   2. `createPost` then marked the clip — handing the mark module the
 *      **original 200 MB pick**, because that was the only path it had. That is
 *      a second decode and a second H.264 encode of the largest file on the
 *      phone, at the camera's own resolution.
 *   3. The marked file is written at the source's resolution and bitrate, so it
 *      came out near 200 MB again, and `uploadMediaFile` compressed *that* — a
 *      third transcode, of a file the app had just produced, milliseconds after
 *      the other two.
 *
 * Three MediaCodec sessions, two of them on 1080p/4K source, a GL overlay pass,
 * and three large files on disk at once. Android kills the process for memory
 * and the member sees the app close during "compressing" — which is exactly the
 * report: *the APK force-closes while compressing an uploaded video*.
 *
 * The fix is not a smaller buffer, it is an order: compress **once**, then let
 * everything afterwards — the upload, the mark, the second upload — work on the
 * copy that came out of it. The original pick is never decoded again.
 *
 * `planMark` still owns every reason to skip (web, no encoder, already marked,
 * too big). This adds the one thing it could not know: which file to hand over.
 */

import { planMark } from './clipMarkPlan';
import type { MarkPlan } from './clipMarkPlan';

export type ClipPostPlanInput = {
  /** 'android' | 'ios' | 'web'. Marking is Android-only today. */
  platform: string;
  /** Does the native module say this device can encode H.264? */
  encoderAvailable: boolean;
  /** Bytes of the file the picker handed over. */
  pickedBytes: number | null;
  /**
   * Bytes of the file that will actually be uploaded — the compressed copy when
   * the pick was big enough to need one, otherwise the pick itself. `null` only
   * when nothing could be measured, which the caller must treat as "the pick".
   */
  preparedBytes: number | null;
  /** true when the picked file already carries a mark (a re-post of a saved clip). */
  alreadyMarked?: boolean;
};

export type ClipPostPlan =
  /** Mark the prepared (compressed) copy — never the original pick. */
  | { markFrom: 'prepared'; bytes: number | null; endCard: boolean }
  | { markFrom: 'none'; reason: Extract<MarkPlan, { action: 'skip' }>['reason'] };

/**
 * The size the mark will be given: the prepared copy, falling back to the pick.
 *
 * Falls back only when the prepared size is unknown, which on a phone means the
 * file could not be measured — and in that case the clip is small enough that
 * the pick *is* what was uploaded (see `planUpload`: an unmeasurable file is
 * used as-is). A large pick can therefore never reach the mark un-measured,
 * because a clip that needs compressing has to be measured first.
 */
export function clipToMarkBytes(input: ClipPostPlanInput): number | null {
  return input.preparedBytes ?? input.pickedBytes;
}

export function planClipPost(input: ClipPostPlanInput): ClipPostPlan {
  const bytes = clipToMarkBytes(input);
  const decision = planMark({
    platform: input.platform,
    encoderAvailable: input.encoderAvailable,
    bytes,
    alreadyMarked: input.alreadyMarked,
  });
  if (decision.action === 'skip') return { markFrom: 'none', reason: decision.reason };
  return { markFrom: 'prepared', bytes, endCard: decision.endCard };
}

/**
 * Whether the marked copy can go straight up, or still needs compressing.
 *
 * A mark at the prepared copy's resolution and bitrate comes out about the same
 * size, so most of the time it uploads as it is — no fourth transcode. When the
 * encoder overshoots, the upload ceiling decides, and the normal path applies.
 */
export function markedCopyFitsUpload(bytes: number | null, uploadMaxBytes: number): boolean {
  return bytes !== null && bytes > 0 && bytes <= uploadMaxBytes;
}

/**
 * The label under the spinner while the mark runs.
 *
 * It is not "Compressing" any more, on purpose: at this point the compression is
 * done and the member has already waited for it. Saying the same thing twice
 * reads as a stuck app.
 */
export function markStageLabel(): string {
  return 'Adding your name to the clip';
}
