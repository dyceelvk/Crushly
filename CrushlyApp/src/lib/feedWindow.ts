/**
 * Which part of the feed is allowed to be alive.
 *
 * A feed can hold a hundred posts. A phone does not have a hundred of anything —
 * not memory, not decoders, not attention. What a mature feed does, and what a
 * short-video viewer does at its most basic, is keep a small window around the
 * thing you are looking at and treat everything else as a row of numbers.
 *
 * This is the arithmetic of that window, kept separate from React so it can be
 * reasoned about and tested on its own.
 */

/** How many posts either side of the active one stay mounted. */
export const FEED_WINDOW_RADIUS = 1;

export type FeedWindow = {
  /** First index that should be mounted, inclusive. */
  start: number;
  /** Last index that should be mounted, inclusive. */
  end: number;
  /** The index the reader is on, clamped into range. Null when the feed is empty. */
  active: number | null;
};

/**
 * The window around `activeIndex`, clamped to the list.
 *
 * With a radius of 1 and twelve posts, standing on post 5 keeps 4, 5 and 6
 * mounted: the one you left (so scrolling back is instant), the one you are on,
 * and the one you are about to reach (so it is decoded before you get there).
 */
export function feedWindow(count: number, activeIndex: number, radius = FEED_WINDOW_RADIUS): FeedWindow {
  if (count <= 0) return { start: 0, end: -1, active: null };

  const active = Math.min(Math.max(activeIndex, 0), count - 1);
  const span = Math.max(0, Math.floor(radius));

  return {
    start: Math.max(0, active - span),
    end: Math.min(count - 1, active + span),
    active,
  };
}

/** Whether an index is inside the mounted window. */
export function isMounted(win: FeedWindow, index: number): boolean {
  return index >= win.start && index <= win.end;
}

/**
 * Whether this post is the one that may play.
 *
 * Only ever true for the active index — which is the whole point. A clip that is
 * merely mounted is preloaded, not playing; a clip outside the window is not
 * even that.
 */
export function isAudible(win: FeedWindow, index: number): boolean {
  return win.active !== null && index === win.active;
}
