import { requireOptionalNativeModule } from 'expo';
import { EventEmitter } from 'expo-modules-core';
import { File, Paths } from 'expo-file-system';

/**
 * Calling the compressor module, with the messy parts in one place.
 *
 * The encoder is Media3 Transformer on the phone (see
 * `modules/holupp-clip-compress`), which sets an exact bitrate and resolution.
 * That replaced ffmpeg-kit's "auto" mode, which picked both itself and picked
 * them badly — a 1080p clip came out looking worse than a 480p one because
 * the encoder starved.
 *
 * Everything here is best-effort except one case: when the phone has no room
 * for the output, the failure is the member's to act on, so it is thrown as a
 * `NoSpaceError` with the true reason instead of being swallowed.
 */
type CompressModule = {
  available: () => boolean;
  compress: (
    inputPath: string,
    outputPath: string,
    targetBytes: number,
  ) => Promise<{ path: string; bytes: number; ms: number }>;
  addListener?: (eventName: string) => void;
  removeListeners?: (count: number) => void;
};

const native = requireOptionalNativeModule<CompressModule>('HolupClipCompress');

/** The phone cannot hold the compressed copy next to the original. */
export class NoSpaceError extends Error {
  code = 'E_NO_SPACE';
  constructor(message = 'Your phone is out of storage space. Free some up, then try again.') {
    super(message);
    this.name = 'NoSpaceError';
  }
}

export function clipCompressorAvailable(): boolean {
  try {
    return native?.available() === true;
  } catch {
    return false;
  }
}

const strip = (uri: string) => uri.replace(/^file:\/\//, '');

/**
 * Compress `inputUri` and hand back the new file, or null when it did not work.
 *
 * Output goes beside the input in the cache directory, not in Documents: a
 * compressed copy is disposable once it is uploaded, and leaving it in
 * Documents fills the phone with clips nobody can see.
 *
 * Throws `NoSpaceError` when the phone is out of storage — the one failure the
 * member can fix, and the one that must not be hidden behind "we couldn't read
 * that file".
 */
export async function compressClipFile(
  inputUri: string,
  targetBytes: number,
  onProgress?: (fraction: number) => void,
): Promise<{ uri: string; bytes: number; ms: number } | null> {
  if (!native) return null;
  try {
    const output = new File(Paths.cache, 'holupp-compressed', `${Date.now()}.mp4`);
    const events = new EventEmitter<{ onProgress: (event: { progress: number }) => void }>(native as never);
    const subscription = events.addListener('onProgress', (event: { progress: number }) => {
      onProgress?.(event.progress);
    });
    try {
      const result = await native.compress(strip(inputUri), strip(output.uri), targetBytes);
      return { uri: `file://${result.path}`, bytes: result.bytes, ms: result.ms };
    } finally {
      subscription.remove();
    }
  } catch (e) {
    removeCompressedClip(output.uri);
    if ((e as { code?: string } | null)?.code === 'E_NO_SPACE') {
      throw new NoSpaceError((e as Error).message);
    }
    // Deliberately quiet for every other failure: the caller uploads the file
    // it already had, which is the honest fallback.
    return null;
  }
}

/** Delete the disposable compressed copy once the upload has read it. */
export function removeCompressedClip(uri: string): void {
  try {
    new File(uri).delete();
  } catch {
    // Cache cleanup is best-effort; it must never turn a good upload into a failure.
  }
}
