/**
 * File extensions and content types for media uploads.
 *
 * Kept out of `api/client.ts` on purpose: that module reaches for React Native,
 * which the Node test runner cannot transform, so anything defined there is
 * effectively untested. These two functions decide what a file is stored as,
 * which is exactly the kind of thing that should have a test.
 */

/**
 * File extension for a mime type, with sensible fallbacks.
 *
 * Video is checked first and on its own: `video/mp4` also contains "mp4", so a
 * clip used to fall through to the audio branch and be stored as `.m4a`. The
 * server then refused the upload as an unsupported file type, the client fell
 * back to a destination that could not serve it, and what a member saw was a
 * post that would not share with a row-policy error attached.
 */
export function extensionFor(mimeType: string | undefined, fallback = 'jpg'): string {
  const type = (mimeType ?? '').toLowerCase();
  if (type.startsWith('video/')) {
    if (type.includes('webm')) return 'webm';
    if (type.includes('quicktime')) return 'mov';
    return 'mp4';
  }
  if (type.includes('jpeg')) return 'jpg';
  if (type.includes('webm')) return 'webm';
  if (type.includes('mpeg') || type.includes('mp3')) return 'mp3';
  if (type.includes('mp4') || type.includes('m4a') || type.includes('aac')) return 'm4a';
  if (type.includes('heic') || type.includes('heif')) return 'heic';
  if (type.includes('png')) return 'png';
  const fromType = type.split('/')[1];
  return fromType && fromType.length <= 5 ? fromType : fallback;
}

/**
 * The content type to send for a file, given what the picker claimed and the
 * extension we are actually going to store.
 *
 * Phone cameras hand back `video/quicktime` for a clip that ends up as `.mp4`,
 * and the server accepts neither the container name nor the mismatch. Deriving
 * the type from the stored extension keeps the two in step.
 */
export function uploadContentType(mimeType: string | undefined, ext: string): string {
  const type = (mimeType ?? '').toLowerCase();
  if (ext === 'mp4') return 'video/mp4';
  if (ext === 'm4a') return 'audio/mp4';
  if (ext === 'webm') return type.startsWith('audio/') ? 'audio/webm' : 'video/webm';
  if (ext === 'jpg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return type || 'application/octet-stream';
}

/**
 * What kind of file a clip is, from the name the picker gave it.
 *
 * Phones label a video three ways depending on where it came from: an mp4 from
 * a download or a recorded clip, a `.mov` from an iPhone or a Samsung gallery,
 * and sometimes no type at all. The label decides how the bytes are treated, so
 * it is read from the extension wherever there is one and only falls back to
 * the picker's claim.
 */
export type ClipContainer = 'mp4' | 'webm' | 'mov' | 'unknown';

export function clipContainer(mimeType: string | null | undefined, uri: string): ClipContainer {
  const ext = (uri.split('?')[0].split('.').pop() ?? '').toLowerCase();
  if (ext === 'mp4' || ext === 'm4v') return 'mp4';
  if (ext === 'webm') return 'webm';
  if (ext === 'mov' || ext === 'qt') return 'mov';

  const type = (mimeType ?? '').toLowerCase();
  if (type.includes('webm')) return 'webm';
  if (type.includes('quicktime') || type.includes('video/mov')) return 'mov';
  if (type.includes('mp4') || type.includes('m4v')) return 'mp4';
  return 'unknown';
}

/** True when the server will accept the container as it stands. */
export function containerIsStorable(c: ClipContainer): boolean {
  return c === 'mp4' || c === 'webm';
}

/**
 * The content type to send for a clip, given what is actually being uploaded.
 *
 * This is deliberately not a copy of the picker's claim: a phone that reports
 * `video/quicktime` for a path that ends `.mp4` would otherwise have its file
 * refused by a server that reads the header, not the name.
 */
export function clipContentType(mimeType: string | null | undefined, uri: string): string {
  const c = clipContainer(mimeType, uri);
  if (c === 'webm') return 'video/webm';
  if (c === 'mov') return 'video/quicktime';
  return 'video/mp4';
}
