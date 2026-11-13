/**
 * How a file leaves the phone: streamed from disk, or read into a Blob first.
 *
 * This exists because the second option has a ceiling measured in the phone's
 * memory, and a video passes it.
 *
 * The report that put this here: on 1.0.109 the compressor finished — 99, 100 —
 * the spinner said "Uploading", and about seven seconds later the app closed.
 * Everything up to the upload had been fixed; the upload itself was still
 * `uriToBlob(file)` and then `fetch(url, { body: blob })`, which asks the JS
 * runtime to hold the whole clip, and then asks the networking layer to make its
 * own copy of it to send. Two copies of a 60–96 MB file is not a request a
 * mid-range Android phone survives, and the kill is silent.
 *
 * The fix is not a smaller buffer, it is not putting the bytes in the heap at
 * all: `expo-file-system`'s `uploadAsync` hands the path to the platform, which
 * streams the file into the request body. Memory stays flat no matter how big
 * the clip is.
 *
 * A Blob is still the right answer for small files and for the web, where there
 * is no file to point at — and, importantly, as the fallback when a build has no
 * upload module at all. Getting this wrong must cost speed, never a post, so the
 * decision is a pure function and is tested without a phone.
 */

export type UploadTransport =
  /** Hand the file path to the platform: no bytes in the JS heap. */
  | 'disk-stream'
  /** Read the file into a Blob and send that. Fine for photos; fatal for big clips. */
  | 'blob';

/**
 * @param platform        'android' | 'ios' | 'web'
 * @param uri             the uri the upload is about to read
 * @param hasUploadAsync  does this build actually carry `FileSystem.uploadAsync`
 */
export function uploadTransport(platform: string, uri: string, hasUploadAsync: boolean): UploadTransport {
  if (platform === 'web') return 'blob';
  if (!hasUploadAsync) return 'blob';
  // A local file is the only thing the platform can stream. `content://` is
  // included because it is copied into the cache first and becomes one.
  return /^(file|content):\/\//i.test(uri) ? 'disk-stream' : 'blob';
}

/**
 * Above this, a Blob in the JS heap is a risk rather than a convenience.
 *
 * Not a hard limit — nothing is refused at this size — it is the line where the
 * app should say plainly that it could not stream the file, instead of trying
 * the memory-hungry path and being killed halfway through it.
 */
export const BLOB_SAFE_BYTES = 24 * 1024 * 1024;

/**
 * Whether a file is small enough to fall back to the Blob path safely.
 *
 * `null` (unknown size) is treated as unsafe: an unmeasured file could be
 * anything, and the whole point of the fallback being quiet is that it is not
 * attempted on the one file that would kill the app.
 */
export function blobFallbackIsSafe(bytes: number | null): boolean {
  return bytes !== null && bytes > 0 && bytes <= BLOB_SAFE_BYTES;
}

/** What the member is told when the phone cannot stream the file it must send. */
export const STREAM_FAILED_MESSAGE =
  'holUpp couldn’t send that video from this phone. Your original is still safe — please try again.';
