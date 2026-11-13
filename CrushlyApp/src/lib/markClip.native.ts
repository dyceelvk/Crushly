import { requireOptionalNativeModule } from 'expo';
import { Directory, File, Paths } from 'expo-file-system';
import { planMark, type MarkInputs, type MarkPlan } from './clipMarkPlan';

/**
 * Calling the mark module, with the messy parts in one place.
 *
 * Everything here is best-effort by design: a clip that cannot be marked is
 * still a clip that should be posted. The caller gets `null` and uploads the
 * file it already had.
 */
type MarkModule = {
  available: () => boolean;
  mark: (inputPath: string, outputPath: string, handle: string, endCardPath: string | null) => Promise<{ path: string; bytes: number; ms: number }>;
};

const native = requireOptionalNativeModule<MarkModule>('HolupClipMark');

export function markEncoderAvailable(): boolean {
  try {
    return native?.available() === true;
  } catch {
    return false;
  }
}

export function planForClip(bytes: number | null, alreadyMarked = false): MarkPlan {
  const inputs: MarkInputs = {
    platform: 'android',
    encoderAvailable: markEncoderAvailable(),
    bytes,
    alreadyMarked,
  };
  return planMark(inputs);
}

/**
 * Mark `inputUri` and hand back the new file, or null when it did not work.
 *
 * Output goes beside the input in the cache directory, not in Documents: a
 * marked copy is disposable once it is uploaded, and leaving it in Documents
 * fills the phone with clips nobody can see.
 */
export async function markClipFile(inputUri: string, handle: string, endCardUri?: string): Promise<{ uri: string; bytes: number; ms: number } | null> {
  if (!native) return null;
  try {
    const input = new File(inputUri);
    const output = new File(Paths.cache, 'holupp-marked', `${Date.now()}.mp4`);
    const result = await native.mark(
      input.uri.replace(/^file:\/\//, ''),
      output.uri.replace(/^file:\/\//, ''),
      handle,
      endCardUri ? endCardUri.replace(/^file:\/\//, '') : null,
    );
    return { uri: `file://${result.path}`, bytes: result.bytes, ms: result.ms };
  } catch {
    // Deliberately silent to the member: the post continues unmarked and the
    // scheduled job picks it up. Logging the reason is the caller's business.
    return null;
  }
}

/**
 * Delete the marked copy once the upload has read it.
 *
 * Best-effort, like every other cache cleanup here: a file that will not delete
 * must never turn a finished post into a failure.
 */
export function removeMarkedClip(uri?: string | null): void {
  if (!uri) return;
  try {
    new File(uri).delete();
  } catch {
    // the phone's cache sweeper will get it
  }
}

export { Directory };
