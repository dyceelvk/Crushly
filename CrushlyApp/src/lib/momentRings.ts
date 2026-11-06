/**
 * The colour of a Moment's ring.
 *
 * A Moment is not a post and not a Vibe: it is one glimpse with a day to live,
 * which is why it gets a ring around the picture rather than a card in a feed.
 * The ring is coloured for the same reason a story ring anywhere is coloured —
 * a ring says "there is something here *now*" without a badge, a number or a
 * second line of type.
 *
 * The colour is a property of the person, not of the Moment: the same member
 * wears the same ring on their Space, on the Moments row and beside their name
 * in the feed, and it does not change between launches. That is the whole reason
 * this lives in `lib/` where it can be tested — a random colour per render would
 * read as a glitch.
 */
export const MOMENT_RING_COLORS = [
  '#FF4081', // crush
  '#00C6FF', // primary
  '#FFC657', // gold
  '#7C5CFF', // violet
  '#38E8A6', // mint
  '#FF7A45', // ember
] as const;

/** The ring colour for a member. Stable for an id, for ever. */
export function momentRingColor(userId: number): string {
  const n = Math.abs(Math.trunc(Number.isFinite(userId) ? userId : 0));
  return MOMENT_RING_COLORS[n % MOMENT_RING_COLORS.length];
}

/**
 * The ring a viewed Moment keeps.
 *
 * A ring that has been watched is not the same thing as no ring at all: there is
 * still something live behind this picture, and the picture is still the door to
 * it. So a viewed Moment wears a quiet ring rather than losing it — which is the
 * difference between "you have seen this" and "there is nothing here", and the
 * reason the Moments surface can say *Viewed* instead of looking empty.
 */
export const MOMENT_RING_SEEN = 'rgba(255,255,255,0.30)';

/**
 * The ring a picture should wear, or `null` when there is nothing live.
 *
 * Kept as a separate function rather than folded into the one above so a caller
 * that has the "unseen" answer to hand never has to invent one: no ring is a
 * colour too, and `null` says that without a magic string.
 */
export function momentRing(userId: number, live: boolean): string | null {
  return live ? momentRingColor(userId) : null;
}

/**
 * The same question with the answer the Moments surfaces actually have: live and
 * seen are two booleans, and they produce three rings.
 */
export function momentRingState(userId: number, live: boolean, seen: boolean): string | null {
  if (!live) return null;
  return seen ? MOMENT_RING_SEEN : momentRingColor(userId);
}
