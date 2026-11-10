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
  return post.mediaKind === 'video' && typeof post.downloadUrl === 'string' && post.downloadUrl.length > 0;
}

/** `holup-<post id>.mp4` — a name that survives being found again in a gallery. */
export function clipFileName(postId: number, url: string): string {
  const match = /\.(mp4|mov|m4v|webm)(?:\?|$)/i.exec(url);
  const ext = (match?.[1] ?? 'mp4').toLowerCase();
  return `holup-${postId}.${ext}`;
}
