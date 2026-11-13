/**
 * The web and desktop side of compressing, which is: nothing.
 *
 * A file picked in a browser is a Blob and the browser's own transcode lives in
 * `compressVideo.ts`; this module is only the native encoder's door, and there
 * is no native encoder in a browser. Keeping this file separate means the
 * native module is never imported on web — importing native code there
 * white-screens the app.
 */

export class NoSpaceError extends Error {
  code = 'E_NO_SPACE';
  constructor(message = 'Your phone is out of storage space. Free some up, then try again.') {
    super(message);
    this.name = 'NoSpaceError';
  }
}

export function clipCompressorAvailable(): boolean {
  return false;
}

/**
 * Same signature as the native version, so call sites do not branch on
 * platform. On the web there is no native encoder to call.
 */
export async function compressClipFile(
  _inputUri?: string,
  _targetBytes?: number,
  _onProgress?: (fraction: number) => void,
): Promise<{ uri: string; bytes: number; ms: number } | null> {
  return null;
}

/** Web creates no native temp file. */
export function removeCompressedClip(_uri: string): void {}
