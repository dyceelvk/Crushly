/**
 * A profile picture is a door, and which room it opens depends on what is
 * behind it — not on which screen you happen to be standing in.
 *
 * Three situations, one rule set:
 *
 *   nothing live            → the person's Space
 *   a live Moment           → the Moment viewer
 *   already in that viewer  → the Space, so a Moment is never a trap
 *
 * The decision is a pure function on purpose. Every screen that shows somebody's
 * picture asks this question, and if each one answered it in its own `onPress`
 * they would eventually disagree — one screen opening the viewer for a person
 * with nothing live, another refusing to leave the viewer at all. Keeping the
 * rule in one tested place is how "tapping a picture always behaves the same"
 * stops being a promise and becomes a property of the code.
 */

export type ProfileDestination = 'moment' | 'space';

export type ProfileTapInput = {
  /** Whose picture was tapped. */
  userId: number;
  /** Members with a Moment that is live *right now*, from the backend. */
  liveMoments: ReadonlySet<number>;
  /** The Moment viewer you are inside, and whose Moment it is showing. */
  viewingMomentOf?: number | null;
};

export function profileDestination({ userId, liveMoments, viewingMomentOf }: ProfileTapInput): ProfileDestination {
  // Inside this person's Moment already: the picture is the way out to their
  // Space. Reopening the viewer would be a door that leads to itself.
  if (viewingMomentOf != null && viewingMomentOf === userId) return 'space';
  return liveMoments.has(userId) ? 'moment' : 'space';
}

/**
 * Which members have something live, read from the one Moments response every
 * Moments surface already shares.
 *
 * "Live" is not "unseen". A ring that has been looked at still sits around the
 * picture until the Moment expires, and the picture still opens the viewer — the
 * backend decides both, by only returning Moments whose `expires_at` is in the
 * future and that this member is allowed to see.
 */
export function liveMomentUserIds(feed: {
  mine?: { user: { id: number } } | null;
  others?: { user: { id: number } }[];
} | undefined | null): Set<number> {
  const ids = new Set<number>();
  const mine = feed?.mine?.user?.id;
  if (mine) ids.add(mine);
  for (const group of feed?.others ?? []) {
    if (group?.user?.id) ids.add(group.user.id);
  }
  return ids;
}
