/**
 * Motion, as numbers.
 *
 * Every animation in the app comes from this file, and these numbers were not
 * chosen by taste — they were measured. Two editors were opened in a browser
 * and their stylesheets read: the clip editor's keyframes and the feed app's
 * tab transitions. Both land on the same small set of values, which is the
 * point. A motion system is not many animations; it is about six, reused.
 *
 * What was found in the two stylesheets:
 *
 *   `playPause`       opacity 1 → 0 while scale runs 1 → 1.3, so the control
 *                     evaporates as it grows rather than shrinking away.
 *   `label-in`        fade up from nothing plus a four-pixel rise. Not ten.
 *   `label-out`       opacity to 0, no movement: leaving is quieter than
 *                     arriving, always.
 *   panel slides      translateX(56px) → 0, 200 ms-class, ease-out.
 *   entering content  fade plus a short translate, never a scale.
 *
 * So the rules here are: enter by rising a few pixels, leave by fading only,
 * keep everything between 120 and 260 ms, and stagger in steps of 40 ms capped
 * at four items so the last card is not still arriving when you read it.
 *
 * With reduce-motion on, all of it collapses to "visible". The animation was
 * never the information.
 */

/**
 * Cubic-bézier easing, in plain arithmetic.
 *
 * Deliberately not React Native's `Easing`: this file has to load in a plain
 * node test, and importing the platform to compute a curve would make the
 * numbers untestable — which is the one thing a motion system must not be.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const curve = (a: number, b: number) => (t: number) =>
    3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  const x = curve(x1, x2);
  const y = curve(y1, y2);

  // Solve x(t) = input for t, then read y(t). Newton first, bisection when the
  // slope is flat, which is the usual way this is done in a browser.
  const solve = (input: number): number => {
    let t = input;
    for (let i = 0; i < 8; i++) {
      const error = x(t) - input;
      if (Math.abs(error) < 1e-5) return y(t);
      const slope = 3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2);
      if (Math.abs(slope) < 1e-6) break;
      t -= error / slope;
    }
    let lo = 0;
    let hi = 1;
    t = input;
    for (let i = 0; i < 20; i++) {
      if (x(t) < input) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return y(t);
  };

  return (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : solve(t));
}

/** Durations, in milliseconds. There are only four, and they mean something. */
export const DUR = {
  /** A control acknowledging a touch. Below this it is not seen at all. */
  tap: 120,
  /** The default: state changing in place, a tab, a colour, a label. */
  label: 200,
  /** Content arriving on screen. One step slower, because it travels. */
  enter: 260,
  /** Something leaving. Never slower than arriving. */
  exit: 160,
} as const;

/** The one curve. Decelerating, so movement feels like it is being placed. */
export const EASE_OUT = cubicBezier(0.2, 0.8, 0.2, 1);

/** For things that leave: no anticipation, just gone. */
export const EASE_IN = cubicBezier(0.4, 0, 1, 1);

/** Distances, in points. Small on purpose. */
export const TRAVEL = {
  /** Text and labels. Measured at 4 px in the editor's `label-in`. */
  label: 4,
  /** Cards and rows. */
  card: 10,
  /** A panel arriving from the side, measured at 56 px. */
  panel: 56,
} as const;

/** The play/pause control's flash: it grows to 1.3 as it disappears. */
export const FLASH_SCALE = 1.3;

/**
 * The delay before the nth item of a list arrives.
 *
 * Forty milliseconds apart, and never deeper than four, because a stagger that
 * outlives its own list is just a slow screen.
 */
export const STAGGER = 40;
export const STAGGER_CAP = 4;

export function stagger(index: number, step: number = STAGGER, cap: number = STAGGER_CAP): number {
  return Math.max(0, Math.min(index, cap)) * step;
}

/**
 * How long a staggered list takes to finish arriving. Used by tests, and by
 * anything that has to wait for the room to settle before measuring it.
 */
export function staggerTotal(count: number, step: number = STAGGER, cap: number = STAGGER_CAP): number {
  return stagger(Math.max(0, count - 1), step, cap) + DUR.enter;
}

/** A duration that respects reduce-motion: zero when motion is off. */
export function duration(ms: number, reduceMotion: boolean): number {
  return reduceMotion ? 0 : ms;
}

/**
 * The crossfade used when one view replaces another in place — a tab switch, a
 * section changing under a fixed heading.
 *
 * The outgoing view is faded out over `exit` and the incoming one fades in
 * after a short hold, so for a moment neither is fully there. That gap is what
 * makes a switch read as a change of content rather than a flicker of the same
 * content.
 */
export const CROSSFADE = { out: DUR.exit, hold: 60, in: DUR.enter } as const;

export function crossfadeDelays(reduceMotion: boolean): { out: number; in: number } {
  if (reduceMotion) return { out: 0, in: 0 };
  return { out: CROSSFADE.out, in: CROSSFADE.out + CROSSFADE.hold };
}

/**
 * Tab colour, as an interpolation. TikTok's tab row changes *only* colour —
 * active near-white, inactive at 60% — with no underline and no pill, so the
 * whole state change is one value fading from one to the other over `label`.
 */
export function tabInk(active: boolean): { opacity: number; weight: 500 } {
  // The weight is the same either way — measured at 500 on both the selected
  // and the unselected tab. Only the brightness moves.
  return { opacity: active ? 1 : 0.6, weight: 500 };
}
