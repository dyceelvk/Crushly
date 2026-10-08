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
