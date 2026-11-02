/**
 * The timeline: a clip becomes pieces.
 *
 * Until now an edit had exactly one decision — where it starts and where it
 * stops — so the board could only ever show one window over one file. A real
 * editor is a *sequence*: cut the file in two, drop the middle, move a piece.
 *
 * Everything here is pure and lives in seconds in two different clocks, and
 * keeping them apart is most of the difficulty:
 *
 *   source seconds   where a frame lives in the file on disk
 *   cut seconds      where it lives in what you are making
 *
 * A segment is a window in source seconds. The sequence is those windows laid
 * end to end, so cut time is the running total of the ones before it. When the
 * timeline is a single window — the ordinary trim — the two clocks agree, which
 * is why the rest of the app did not have to change to gain this.
 */

export type Segment = {
  id: string;
  /** Source seconds. */
  start: number;
  end: number;
};

/** Shortest piece worth having, in seconds. Below this a cut is a mistake. */
export const MIN_SEGMENT = 0.2;

let counter = 0;
function nextId(): string {
  counter += 1;
  return `s${Date.now().toString(36)}${counter.toString(36)}`;
}

/** The sequence for an edit that has never been cut: one window, the trim. */
export function singleSegment(trimStart: number, trimEnd: number): Segment[] {
  return [{ id: nextId(), start: Math.max(0, trimStart), end: Math.max(trimStart + MIN_SEGMENT, trimEnd) }];
}

/** Length of one segment, never negative. */
export function lengthOf(s: Segment): number {
  return Math.max(0, s.end - s.start);
}

/** How long the whole sequence runs, in cut seconds. */
export function durationOf(segments: Segment[]): number {
  return segments.reduce((t, s) => t + lengthOf(s), 0);
}

/** Which segment contains a cut time, and how far into it that is. */
export function locate(segments: Segment[], cutTime: number): { segment: Segment; index: number; into: number } | null {
  let walked = 0;
  for (let i = 0; i < segments.length; i++) {
    const len = lengthOf(segments[i]);
    if (cutTime < walked + len || i === segments.length - 1) {
      return { segment: segments[i], index: i, into: Math.max(0, Math.min(len, cutTime - walked)) };
    }
    walked += len;
  }
  return null;
}

/** Cut time → the frame in the file. */
export function sourceAt(segments: Segment[], cutTime: number): number {
  const at = locate(segments, cutTime);
  if (!at) return segments[0]?.start ?? 0;
  return at.segment.start + at.into;
}

/** A frame in the file → cut time, or null if that frame was cut away. */
export function cutTimeAt(segments: Segment[], sourceTime: number): number | null {
  let walked = 0;
  for (const s of segments) {
    if (sourceTime >= s.start - 0.001 && sourceTime <= s.end + 0.001) {
      return walked + Math.max(0, Math.min(lengthOf(s), sourceTime - s.start));
    }
    walked += lengthOf(s);
  }
  return null;
}

/**
 * Cut the sequence at a cut time.
 *
 * The piece you were looking at becomes two pieces that meet exactly at the
 * playhead — no frames lost, none shown twice. Cutting on a boundary, or too
 * close to one, changes nothing and says so by returning the same array, which
 * lets the UI stop an undo entry being written for a no-op.
 */
export function splitAt(segments: Segment[], cutTime: number): Segment[] {
  const at = locate(segments, cutTime);
  if (!at) return segments;
  const { segment, index, into } = at;
  if (into < MIN_SEGMENT || lengthOf(segment) - into < MIN_SEGMENT) return segments;
  const at0 = round3(segment.start + into);
  const left: Segment = { ...segment, end: at0 };
  const right: Segment = { id: nextId(), start: at0, end: segment.end };
  const next = segments.slice();
  next.splice(index, 1, left, right);
  return next;
}

/** Times are stored to the millisecond; float drift must never shrink a piece. */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Trim one piece. It may not leave its neighbours or collapse. */
export function trimSegment(segments: Segment[], id: string, start: number, end: number): Segment[] {
  return segments.map((s) => {
    if (s.id !== id) return s;
    const lo = round3(Math.max(0, Math.min(start, end - MIN_SEGMENT)));
    let hi = round3(Math.max(lo + MIN_SEGMENT, end));
    if (hi - lo < MIN_SEGMENT) hi = round3(lo + MIN_SEGMENT);
    return { ...s, start: lo, end: hi };
  });
}

/** Take a piece out of the sequence. The last piece is never removed. */
export function removeSegment(segments: Segment[], id: string): Segment[] {
  if (segments.length < 2) return segments;
  const next = segments.filter((s) => s.id !== id);
  return next.length ? next : segments;
}

/** Put a copy of a piece directly after itself. */
export function duplicateSegment(segments: Segment[], id: string): Segment[] {
  const i = segments.findIndex((s) => s.id === id);
  if (i < 0) return segments;
  const copy: Segment = { ...segments[i], id: nextId() };
  const next = segments.slice();
  next.splice(i + 1, 0, copy);
  return next;
}

/** Move a piece one place earlier (-1) or later (+1). */
export function moveSegment(segments: Segment[], id: string, by: -1 | 1): Segment[] {
  const i = segments.findIndex((s) => s.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= segments.length) return segments;
  const next = segments.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/**
 * The edges a dragged handle should stick to: every piece boundary, the
 * playhead, and the ends of the sequence. A cut that lands exactly on another
 * cut is the difference between an edit that looks deliberate and one that
 * looks approximate.
 */
export function snapTargets(segments: Segment[], playhead: number, tolerance: number): number[] {
  const out: number[] = [0, playhead, durationOf(segments)];
  let walked = 0;
  for (const s of segments) {
    out.push(walked, walked + lengthOf(s));
    walked += lengthOf(s);
  }
  return out.filter((t) => Number.isFinite(t)).map((t) => t);
}

/** Snap a cut time to the nearest edge, or leave it alone if nothing is near. */
export function snap(cutTime: number, targets: number[], tolerance: number): number {
  let best = cutTime;
  let bestGap = tolerance;
  for (const t of targets) {
    const gap = Math.abs(t - cutTime);
    if (gap <= bestGap) {
      bestGap = gap;
      best = t;
    }
  }
  return best;
}

/** Rounded to a tenth of a second: nobody cuts to the millisecond. */
export function snapFrame(t: number): number {
  return Math.round(t * 10) / 10;
}

/**
 * Captions and stickers are stored in cut seconds. When a piece is removed or
 * the sequence changes length, an overlay past the end has nowhere to exist —
 * so it is pulled back inside rather than silently orphaned.
 */
export function clampOverlays<T extends { start: number; end: number }>(items: T[], duration: number): T[] {
  // Rounded to the millisecond so stored times stay tidy and a 0.2 s window
  // does not become 0.19999999999999996 through repeated arithmetic.
  const round = round3;
  return items.map((o) => {
    const start = round(Math.max(0, Math.min(o.start, Math.max(0, duration - MIN_SEGMENT))));
    let end = round(Math.max(start + MIN_SEGMENT, Math.min(o.end, duration)));
    if (end - start < MIN_SEGMENT) end = round(start + MIN_SEGMENT);
    return { ...o, start, end };
  });
}

/**
 * Where playback should be, given where the file is.
 *
 * A clip whose cut could not be baked into the file plays the whole file and
 * hides the difference here: every frame that was cut away is skipped, so what
 * a viewer sees is the clip its author made. Pure, so it can be tested without
 * a player — the skipping is the part most likely to be wrong, and the one
 * thing you cannot check by looking at a screenshot.
 */
export type Follow = {
  /** Time in the clip being watched. */
  cut: number;
  /** Where to move the player, or null to leave it alone. */
  seekTo: number | null;
  /** True when the last piece has finished and the clip is not looping. */
  ended: boolean;
};

export function followCuts(cuts: Segment[], sourceTime: number, loop: boolean): Follow {
  const total = durationOf(cuts);
  if (!cuts.length) return { cut: 0, seekTo: null, ended: false };

  const inside = cutTimeAt(cuts, sourceTime);
  if (inside !== null) {
    if (inside >= total - 0.04) {
      return loop
        ? { cut: 0, seekTo: cuts[0].start, ended: false }
        : { cut: total, seekTo: null, ended: true };
    }
    return { cut: inside, seekTo: null, ended: false };
  }

  // In a gap — a part of the file that was cut away.
  let offset = 0;
  for (const c of cuts) {
    if (c.start > sourceTime) return { cut: offset, seekTo: c.start, ended: false };
    offset += lengthOf(c);
  }

  // Past the end of everything.
  return loop
    ? { cut: 0, seekTo: cuts[0].start, ended: false }
    : { cut: total, seekTo: null, ended: true };
}
