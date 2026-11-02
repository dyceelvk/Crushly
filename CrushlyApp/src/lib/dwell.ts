/**
 * How long a reader actually spent on a post.
 *
 * This is the one signal that makes a ranked feed possible and the one the app
 * never collected: engagement tells you what people chose to do, dwell tells you
 * what happened while they were deciding. TikTok's own client reports it under
 * the names `play_time` and `dwell`; the ranked Flow in
 * `supabase/migrations/20261102000100_ranked_feed.sql` is scored from it.
 *
 * Two rules matter, and both are here rather than in the screen so they can be
 * tested without a phone:
 *
 *   1. A span shorter than `MIN_REPORTABLE_MS` is a scroll, not a read. Reporting
 *      it would teach the ranker that fast scrolling means dislike.
 *   2. A span is only settled when the reader moves to a *different* post. Going
 *      from one post to nothing (a dialog opened, the screen lost focus) must not
 *      close the span, or every interruption becomes a "skip".
 */

/** Spans below this are treated as scrolling past, not reading. */
export const MIN_REPORTABLE_MS = 400;

/** A post held this long counts as watched, even if the clip never finished. */
export const CONSIDERED_MS = 1500;

export type DwellSpan = {
  postId: number;
  ms: number;
  /** The clip or the post was seen to its end, not merely held. */
  completed: boolean;
  position: number | null;
};

export type ActiveSpan = {
  postId: number;
  /** Wall clock at which this post became the active one. */
  sinceMs: number;
  position: number | null;
};

/**
 * What to report when the active post changes.
 *
 * Returns null when there is nothing worth sending: no previous post, the same
 * post (a re-measure, not a move), or a span too short to mean anything.
 */
export function settleDwell(
  previous: ActiveSpan | null,
  nextPostId: number | null,
  nowMs: number,
  completed = false,
): DwellSpan | null {
  if (!previous) return null;
  // Nothing is in front of the reader any more — a sheet opened, the tab lost
  // focus, a card unmounted. The span stays open; it closes on the next post.
  if (nextPostId === null) return null;
  if (previous.postId === nextPostId) return null;
  const ms = Math.max(0, nowMs - previous.sinceMs);
  if (ms < MIN_REPORTABLE_MS) return null;
  return {
    postId: previous.postId,
    ms: Math.min(ms, 3_600_000),
    completed: completed || ms >= CONSIDERED_MS,
    position: previous.position,
  };
}

/** The span to open when the reader arrives on a post. */
export function openSpan(postId: number | null, nowMs: number, position: number | null = null): ActiveSpan | null {
  return postId == null ? null : { postId, sinceMs: nowMs, position };
}
