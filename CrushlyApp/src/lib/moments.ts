import type { Moment, MomentAuthor, MomentsFeed } from '../api/types';

/** A Moment as served by `visible_moments()` — includes its author card. */
export type FeedMoment = Moment & { author: MomentAuthor };

/**
 * Groups the flat Moment feed by member: yours first, then others ordered by
 * unseen → Mutual Crush → recency (the Moments tab's spec).
 */
export function groupMomentFeed(flat: FeedMoment[], me: MomentAuthor): MomentsFeed {
  const groups = new Map<number, { user: MomentAuthor; moments: Moment[] }>();
  for (const { author, ...m } of flat) {
    const entry = groups.get(m.userId) ?? { user: author, moments: [] };
    entry.moments.push(m as Moment);
    groups.set(m.userId, entry);
  }
  const mineEntry = groups.get(me.id);
  groups.delete(me.id);
  const others = [...groups.values()].map((g) => ({
    user: g.user,
    moments: g.moments,
    hasUnseen: g.moments.some((m) => !m.seen),
    latestAt: g.moments[g.moments.length - 1].createdAt,
  }));
  others.sort(
    (a, b) =>
      Number(b.hasUnseen) - Number(a.hasUnseen) ||
      Number(b.user.mutual) - Number(a.user.mutual) ||
      b.latestAt - a.latestAt,
  );
  return {
    mine: { user: mineEntry?.user ?? me, moments: mineEntry?.moments ?? [] },
    others,
  };
}

/** Resolve a search result before the viewer paints or records a view. */
export function initialMomentIndex(moments: readonly { id: number }[], targetId?: number): number | null {
  if (targetId == null) return null;
  const index = moments.findIndex((m) => m.id === targetId);
  return index < 0 ? null : index;
}

/** One person's live Moments. */
export type MomentSequence = { user: MomentAuthor; moments: Moment[] };

/**
 * Which sequence the viewer opens, and where in the feed it begins.
 *
 * A viewer is opened two ways — at a person ("see their Moments") and at a
 * Moment ("that tile, the one I tapped"). Only the second has an exact target,
 * and getting it wrong is not a small wrong: the Moments tab draws a person's
 * newest Moment and, without a target, the viewer opened at their **first**,
 * which could be something they posted twenty hours ago. So the target is looked
 * for across the whole feed, not assumed to be in the tapped person's group — a
 * Moment posted a moment ago sits at the top of the feed and its group can move
 * between the tap and the answer.
 *
 * Returns `[]` when the Moment asked for is not in the answer at all and the
 * viewer has no business inventing a different one. My own Moments are the
 * exception: "nothing of yours is live" would be a lie while they are on the
 * screen behind the viewer, so the sequence stands.
 */
export function momentSequence(
  groups: readonly MomentSequence[] | undefined,
  { userId, mine, momentId }: { userId: number; mine?: boolean; momentId?: number },
): MomentSequence[] {
  const all = groups ?? [];
  if (!all.length) return [];
  let start = mine ? 0 : all.findIndex((g) => g.user.id === userId);
  if (momentId != null) {
    const found = all.findIndex((g) => g.moments.some((m) => m.id === momentId));
    if (found >= 0) start = found;
  }
  if (start < 0) return [];
  const source = all.slice(start);
  if (momentId != null && !mine && !source[0]?.moments.some((m) => m.id === momentId)) return [];
  return source;
}
