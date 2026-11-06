/**
 * A profile picture is a door, and which room it opens depends on two things:
 * what is behind it, and whether the picture is actually wearing the ring.
 *
 * A Moment is opened by the **ring**, not by a name and not by a picture that
 * has no ring around it. That is the rule, and it is a rule about the picture
 * rather than about the screen: a chat header shows an unringed face, so tapping
 * it opens the Space; a ringed face in a feed is offering a Moment, so tapping
 * it opens the Moment. A name is a name — it always opens the Space.
 *
 * Three situations, one rule set:
 *
 *   no ring on this picture  → the person's Space
 *   a ring, nothing live     → the person's Space
 *   a ring, something live   → the Moment viewer
 *   already in that viewer   → the Space, so a Moment is never a trap
 *
 * The decision is a pure function on purpose. Every screen that shows somebody's
 * picture asks this question, and if each one answered it in its own `onPress`
 * they would eventually disagree — one screen opening the viewer for a person
 * with nothing live, another refusing to leave the viewer at all. Keeping the
 * rule in one tested place is how "tapping a picture always behaves the same"
 * stops being a promise and becomes a property of the code.
 */

export type ProfileDestination = 'moment' | 'space';

/**
 * `ring` means: the picture that was tapped is drawn with a Moment ring right
 * now (the caller knows, because it drew it). Anything else — a bare avatar, a
 * name, a row — is `plain` and always opens the Space.
 */
export type ProfileSurface = 'ring' | 'plain';

export type ProfileTapInput = {
  /** Whose picture was tapped. */
  userId: number;
  /** Whether the thing that was tapped was wearing the ring. */
  surface?: ProfileSurface;
  /** Members with a Moment that is live *right now*, from the backend. */
  liveMoments: ReadonlySet<number>;
  /** The Moment viewer you are inside, and whose Moment it is showing. */
  viewingMomentOf?: number | null;
};

/**
 * The Moment viewer's route params for a tapped picture.
 *
 * Yours and somebody else's are not the same screen: the viewer keeps your own
 * Moment in one group and everyone else in another, so opening your own ring
 * without saying whose it is asks for a Moment that is not in that list and
 * finds nothing. A ring you can tap must always open something.
 */
export function momentViewerParams(userId: number, viewerId: number | null | undefined): { userId: number; mine: boolean } {
  return { userId, mine: viewerId != null && userId === viewerId };
}

export function profileDestination({ userId, surface = 'plain', liveMoments, viewingMomentOf }: ProfileTapInput): ProfileDestination {
  // No ring, no Moment. A name is not a ring, and neither is a face in a chat
  // header — those are ways of opening a Space.
  if (surface !== 'ring') return 'space';
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
