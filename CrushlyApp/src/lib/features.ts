/**
 * What this build puts on the screen.
 *
 * Video was switched off, not removed: the players, the trimmer, the encoder,
 * the sound pages and the tables behind them all stayed, waiting behind one
 * boolean. It is switched back on now, deliberately — clips are part of what
 * holUpp offers again, which is what makes the Discover rails ("Top Crushes
 * This Week", trending clips) possible at all.
 *
 * The old rule was "flag, never delete", and it still holds in the other
 * direction: if clips ever have to come off a screen again, they come off by
 * flipping this and nothing is destroyed.
 */
export const VIDEO_ENABLED = true;

/**
 * Only the field that decides it.
 *
 * Optional on purpose, and the list helper is generic rather than constrained:
 * search results and other narrow shapes carry a post's id and words without
 * its media kind, and an absent kind is not a clip.
 */
type Shown = { mediaKind?: 'photo' | 'video' | null };

/**
 * Whether a post belongs on a screen this build shows.
 *
 * True for everything while clips are on. Kept as a function rather than deleted
 * so the lists that ask keep asking: the day a surface has to hide clips again,
 * the answer changes here and every caller follows.
 */
export function isShown(_post: Shown): boolean {
  return true;
}

/**
 * The posts that belong on screen.
 *
 * Applied at every list rather than inside the card, because a card that
 * silently draws nothing leaves the gap where the clip was — and the empty
 * states have to be told the truth about how many posts are left.
 */
export function shownPosts<T>(posts: readonly T[]): T[] {
  return posts.filter((p) => isShown(p as unknown as Shown));
}
