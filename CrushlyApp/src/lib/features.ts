/**
 * What this build puts on the screen.
 *
 * Video is finished. The players, the trimmer, the encoder, the sound pages and
 * the tables behind them all still exist and none of that is being deleted — but
 * it is not part of what Crushly offers today. A member can post a photo or a
 * few words, and no clip is shown anywhere: not in Discover, not on a Space, not
 * inside a Circle, not in Picked.
 *
 * One switch, read in one place, is what keeps "hidden" from turning into
 * "deleted". Turn `VIDEO_ENABLED` on when there is enough of a room to announce
 * it in, and the clip surfaces come back rather than needing to be rebuilt.
 */
export const VIDEO_ENABLED = false;

/**
 * Only the field that decides it.
 *
 * Optional on purpose, and the list helper is generic rather than constrained:
 * search results and other narrow shapes carry a post's id and words without
 * its media kind, and an absent kind is not a clip.
 */
type Shown = { mediaKind?: 'photo' | 'video' | null };

/** Whether a post belongs on a screen this build shows. */
export function isShown(post: Shown): boolean {
  return VIDEO_ENABLED || post.mediaKind !== 'video';
}

/**
 * The posts that belong on screen.
 *
 * Applied at every list rather than inside the card, because a card that
 * silently draws nothing leaves the gap where the clip was — and the empty
 * states have to be told the truth about how many posts are left.
 */
export function shownPosts<T>(posts: readonly T[]): T[] {
  return VIDEO_ENABLED ? posts.slice() : posts.filter((p) => isShown(p as unknown as Shown));
}
