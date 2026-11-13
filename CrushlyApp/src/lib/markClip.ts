/**
 * The web and desktop side of marking, which is: nothing.
 *
 * A file picked in a browser is a Blob and the browser has no encoder to give
 * it; the mark for anything posted from the web is produced by the scheduled
 * job, exactly as before. Keeping this file separate means the native module is
 * never imported on web — importing native code there white-screens the app,
 * which has happened once already with `expo-media-library`.
 */
import { planMark } from './clipMarkPlan';

export type MarkInputs = Parameters<typeof planMark>[0];

export function markEncoderAvailable(): boolean {
  return false;
}

export function planForClip(bytes: number | null, alreadyMarked = false) {
  return planMark({ platform: 'web', encoderAvailable: false, bytes, alreadyMarked });
}

/**
 * Same signature as the native version, so call sites do not branch on platform.
 * On the web there is nothing to mark with: a Blob in the browser has no encoder,
 * and the scheduled job produces the marked copy instead.
 */
export async function markClipFile(
  _inputUri?: string,
  _handle?: string,
  _endCardUri?: string,
): Promise<{ uri: string; bytes: number; ms: number } | null> {
  return null;
}
