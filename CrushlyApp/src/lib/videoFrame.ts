/**
 * How big a video's frame should be, and whether it may crop.
 *
 * This exists because a video was being handed a photo's default frame. The feed
 * reserved 4:5 for every post, photos and videos alike, and the video player then
 * had to either squash the picture into that box (`cover` — a landscape clip lost
 * its left and right thirds) or letterbox it into the middle of it (`contain` — a
 * landscape clip became a thin band floating in black). From the outside both
 * read as "the video is zoomed or cropped", and neither is a rendering bug in the
 * player: it is the frame being the wrong shape for the picture.
 *
 * The rule, in one line: the frame follows the source unless the creator chose a
 * shape, and cropping only ever happens because of that choice.
 */

import { ASPECTS, type AspectId } from './videoEdit';

export type Size = { width?: number | null; height?: number | null } | null | undefined;

/**
 * Width ÷ height of the source, or null when the size is not usable yet.
 *
 * Guards against the three shapes of "no answer": missing, zero, and negative.
 * A ratio of Infinity or NaN reaching a style is a crash on Android.
 */
export function videoRatio(size: Size): number | null {
  const w = Number(size?.width ?? 0);
  const h = Number(size?.height ?? 0);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return w / h;
}

/**
 * The ratio an aspect choice asks for, or null for "whatever the file is".
 * Kept separate from `ASPECTS` so a bad stored value degrades to the source
 * rather than to a wrong frame.
 */
export function aspectRatioOf(aspect: AspectId | string | null | undefined): number | null {
  if (!aspect || aspect === 'original') return null;
  const entry = ASPECTS[aspect as AspectId];
  return entry?.ratio ?? null;
}

/**
 * The frame to draw.
 *
 * `ratio` is what the container should be shaped like, `fit` is what the video
 * player should do inside it, and `crops` says plainly whether the picture is
 * being cut — the one fact a screen may want to surface ("this looks different
 * from the file because the creator chose a square").
 *
 * Clamped to sane bounds so a corrupt or absurd metadata value (a 1×5000 stream,
 * a still-frame sent as video) cannot produce a 0-height box or a mile-tall one.
 */
export function videoFrame({
  measured,
  aspect,
  fallback = 4 / 5,
}: {
  /** W ÷ H reported by the player, if it has loaded. */
  measured?: number | null;
  /** The creator's chosen shape, from the edit. */
  aspect?: AspectId | string | null;
  /** Frame to reserve before anything is known. */
  fallback?: number;
}): { ratio: number; fit: 'cover' | 'contain'; crops: boolean } {
  const chosen = aspectRatioOf(aspect);
  const source = clampRatio(measured ?? null) ?? clampRatio(fallback) ?? 4 / 5;

  // A chosen shape wins: the creator cropped it in the editor on purpose, and
  // showing the uncropped file would contradict what they edited.
  if (chosen) return { ratio: clampRatio(chosen) ?? source, fit: 'cover', crops: true };

  // Otherwise the frame *is* the picture's shape, so nothing is cut and there is
  // no letterbox to explain.
  return { ratio: source, fit: 'contain', crops: false };
}

/** Keep a ratio readable: between a very tall sliver and a very wide banner. */
export function clampRatio(ratio: number | null | undefined): number | null {
  if (ratio == null || !Number.isFinite(ratio) || ratio <= 0) return null;
  return Math.min(3, Math.max(0.3, ratio));
}

/**
 * The height a frame will occupy at a given width, capped.
 *
 * `aspectRatio` in React Native already does the division; this exists for the
 * places that lay a video out themselves (full-screen stages) and need the
 * arithmetic in a number they can reason about — and it is what the tests can
 * assert on, because a style object proves nothing.
 */
export function frameHeight(ratio: number, width: number, maxHeight?: number): number {
  const h = width / Math.max(0.01, ratio);
  return maxHeight ? Math.min(h, maxHeight) : h;
}

/* ------------------------------------------------------------------- stage */

/**
 * A full-screen stage is not a feed card.
 *
 * In the feed the frame follows the file, so the reserved box is the picture's
 * shape and there is nothing left over. A stage has no such freedom: the box is
 * the screen, and the picture is whatever the author shot. Handing a 16:9 clip
 * to a 9:19.5 screen with `contain` leaves a band of nothing above and below it,
 * which is what people read as "the video is broken".
 *
 * So a stage picks a mode, and the mode decides two things at once:
 *
 *   `'fit'`     the whole picture, nothing cropped. The space either side of it
 *               is filled by a blurred copy of the same clip, so the letterbox
 *               is made of the video rather than of black.
 *   `'fill'`    no letterbox at all: the picture is cropped to the stage, the way
 *               a photo already is.
 *
 * `'fit'` is the default because the stage is one post, not a deck — silently
 * cutting a third off each side of what somebody filmed is a worse lie than a
 * soft band. `'fill'` is there for anyone who wants the edges gone.
 */
export type StageFit = 'fit' | 'fill';

export function stageFit(mode: StageFit | undefined): { contentFit: 'cover' | 'contain'; backdrop: boolean } {
  return mode === 'fill'
    ? { contentFit: 'cover', backdrop: false }
    : { contentFit: 'contain', backdrop: true };
}

/**
 * Does the picture actually leave bands in this box?
 *
 * Measured, not assumed: a portrait clip on a portrait screen fills it, and
 * paying for a blurred copy of it behind nothing would be wasted work. A
 * tolerance is required because layout widths are fractional — 0.02 of a ratio
 * is about eight pixels on a phone, well under a band anyone would notice.
 */
export function leavesBands(stageRatio: number | null | undefined, pictureRatio: number | null | undefined): boolean {
  if (!stageRatio || !pictureRatio) return false;
  if (!Number.isFinite(stageRatio) || !Number.isFinite(pictureRatio)) return false;
  if (stageRatio <= 0 || pictureRatio <= 0) return false;
  return Math.abs(stageRatio - pictureRatio) > 0.02;
}
