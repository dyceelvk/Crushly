/**
 * What to do with a picked clip before it is uploaded — the decision, with no
 * native code in it.
 *
 * This exists because getting it wrong rebooted the app. The old order was
 * "read the file into memory, then compress", which on a 200 MB clip means 200 MB
 * in the JavaScript heap and a second copy for the encoder, and Android kills the
 * process for memory before either finishes. The member sees the splash screen
 * again and calls it a crash, which is exactly what it is.
 *
 * The order that cannot run out of memory is: measure the file from disk,
 * compress from its path, read only the result. The rules below are the ones that
 * order depends on, kept here so they can be tested without a phone.
 */
export const PICK_LIMIT_BYTES = 300 * 1024 * 1024;
/** Below this there is nothing to gain from re-encoding. */
export const LEAVE_ALONE_BYTES = 12 * 1024 * 1024;
export const UPLOAD_TARGET_BYTES = 64 * 1024 * 1024;

export type UploadPlan =
  | { action: 'refuse'; reason: string }
  | { action: 'compress-first'; targetBytes: number }
  | { action: 'use-as-is' };

/**
 * @param bytes      size of the picked file, or null when it cannot be measured
 * @param onDevice   true when the file is a `file://` path this phone owns
 */
export function planUpload(bytes: number | null, onDevice: boolean): UploadPlan {
  if (bytes !== null && bytes > PICK_LIMIT_BYTES) {
    return { action: 'refuse', reason: 'That clip is over 300 MB. Trim it first, then post.' };
  }
  // On the web a Blob is already in memory — the browser does not copy it for an
  // upload — so the compress-first order buys nothing there and the existing
  // path stays. On a phone it is the difference between uploading and rebooting.
  if (!onDevice) return { action: 'use-as-is' };
  if (bytes === null) return { action: 'use-as-is' };
  if (bytes <= LEAVE_ALONE_BYTES) return { action: 'use-as-is' };
  return { action: 'compress-first', targetBytes: UPLOAD_TARGET_BYTES };
}
