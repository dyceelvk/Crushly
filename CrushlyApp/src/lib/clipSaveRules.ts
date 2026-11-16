/**
 * What may be saved, and under what name — the decision, with no native code in
 * it. Kept separate from `downloadClip` because that module imports the media
 * library and the filesystem, and a rule that cannot be unit-tested is a rule
 * that gets broken quietly.
 */
export type SaveablePost = {
  mediaKind?: string | null;
  downloadUrl?: string | null;
};

/**
 * A clip only, never a photo, and only when the marked copy exists. Falling back
 * to the unmarked original would hand out somebody's work with no name on it,
 * which is the one outcome this feature must never produce.
 */
export function canSaveClip(post: SaveablePost): boolean {
  /*
   * The URL is the proof, not `mediaKind`.
   *
   * `mediaKind` is guessed from the stored media URL by a feed function, and a
   * clip whose URL did not match that guess read as a photo — so a copy that
   * existed was reported as missing, and the Save row sat at "still being
   * prepared" indefinitely. A marked copy is only ever produced for a clip, so
   * holding one is the only evidence needed.
   */
  return typeof post.downloadUrl === 'string' && post.downloadUrl.length > 0;
}

/** `holup-<post id>.mp4` — a name that survives being found again in a gallery. */
export function clipFileName(postId: number, url: string): string {
  const match = /\.(mp4|mov|m4v|webm)(?:\?|$)/i.exec(url);
  const ext = (match?.[1] ?? 'mp4').toLowerCase();
  return `holup-${postId}.${ext}`;
}

/**
 * A save that failed for a reason worth naming.
 *
 * The three statuses a download can come back with mean three different things,
 * and the app used to say the same sentence for all of them: "try again", which
 * was wrong for a refused session (trying again does nothing) and wrong for a
 * copy that has not been produced yet (trying again in a minute is exactly
 * right). `status` is kept on the error so the caller can act on a 401 — refresh
 * the session and retry once — instead of showing it to the member.
 */
export class SaveError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'SaveError';
    this.status = status;
  }
}

/** What to tell a member about a download that did not return a file. */
export function saveMessageFor(status: number): string {
  if (status === 401 || status === 403) return 'Your session expired. Sign in again, then save the clip.';
  if (status === 404) return 'The mark is still being added to this clip. Try again in a minute.';
  if (status === 429) return 'Too many downloads just now. Give it a moment and try again.';
  return `The clip could not be downloaded (${status}). Please try again.`;
}

/** A refusal that a fresh token can fix — and only those are retried. */
export function isSessionRefused(error: unknown): boolean {
  return error instanceof SaveError && error.status === 401;
}
