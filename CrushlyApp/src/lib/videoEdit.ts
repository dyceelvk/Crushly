/**
 * The video edit model.
 *
 * An edit is a set of instructions, not a new file. The app keeps the clip you
 * chose and remembers what you did to it — where it starts and stops, what is
 * written on it, how it looks, how fast it runs. The player applies all of it
 * every time the clip plays.
 *
 * That choice buys three things a real export cannot: the edit is instant, it
 * stays re-editable months later, and it behaves identically in the app and on
 * the web. It costs one thing — the whole clip is uploaded, so trimming a
 * minute down to ten seconds still stores the minute. If we ever want to trade
 * that away, `exportEdit` in this file is the single seam where a real encoder
 * would take over; nothing above it would change.
 *
 * Two clocks are in play and keeping them straight is most of the difficulty:
 *
 *   source time   seconds into the file on disk
 *   clip time     seconds into your trimmed clip, before speed is applied
 *
 * Overlays (captions and stickers) are stored in clip time. Source time is
 * `trimStart + clipTime`. Wall-clock time is `clipTime / speed`.
 */

import {
  MIN_SEGMENT,
  Segment,
  clampOverlays,
  cutTimeAt,
  durationOf,
  duplicateSegment,
  lengthOf,
  moveSegment,
  removeSegment,
  snapFrame,
  sourceAt,
  splitAt,
  trimSegment,
} from './timeline';

export type EditCategory = 'post' | 'vibe' | 'moment' | 'circle';

export type FilterId =
  | 'none'
  | 'vivid'
  | 'warm'
  | 'cool'
  | 'mono'
  | 'noir'
  | 'fade'
  | 'sunset'
  | 'mint'
  | 'dusk';

export type AspectId = 'original' | '9:16' | '4:5' | '1:1' | '16:9';

export type CaptionStyle = 'none' | 'box' | 'outline';
export type CaptionAnimation = 'none' | 'fade' | 'pop' | 'slide';

export type Caption = {
  id: string;
  text: string;
  /** Centre of the caption as a fraction of the frame, 0..1. */
  x: number;
  y: number;
  /** Clip time, in seconds. */
  start: number;
  end: number;
  /** Font size as a fraction of frame height, roughly 0.02..0.14. */
  size: number;
  color: string;
  style: CaptionStyle;
  animation: CaptionAnimation;
  bold: boolean;
};

export type Sticker = {
  id: string;
  glyph: string;
  x: number;
  y: number;
  start: number;
  end: number;
  /** 0.4 .. 2.4 */
  scale: number;
  /** Degrees. */
  rotation: number;
};

export type MusicTrack = {
  id: string;
  title: string;
  /** Where the audio lives. Remote or bundled. */
  uri: string;
  /** 0..1 */
  volume: number;
  /** Seconds into the track to begin from. */
  offset: number;
};

export type VideoEdit = {
  version: 1;
  /** Length of the file on disk, in seconds. Never changes after load. */
  sourceDuration: number;
  /** Where the clip starts and stops, in source seconds. */
  trimStart: number;
  trimEnd: number;
  speed: number;
  aspect: AspectId;
  filter: FilterId;
  /** -1..1 around neutral. */
  brightness: number;
  contrast: number;
  saturation: number;
  captions: Caption[];
  stickers: Sticker[];
  music: MusicTrack | null;
  /** The clip's own audio, 0..1. */
  clipVolume: number;
  /**
   * The timeline: the pieces of the file you kept, in the order you kept them.
   *
   * One piece is the ordinary trim. Several pieces mean you cut the clip in
   * two and threw a bit away, or put a piece in twice — which is what an editor
   * is for, and what a single window over one file could never express.
   *
   * `trimStart` and `trimEnd` are kept in step with the ends of this list so
   * that everything written before the timeline existed still reads correctly.
   */
  segments: Segment[];
};

export const SPEEDS = [0.5, 0.75, 1, 1.5, 2] as const;

export const ASPECTS: Record<AspectId, { label: string; ratio: number | null }> = {
  original: { label: 'Original', ratio: null },
  '9:16': { label: '9:16', ratio: 9 / 16 },
  '4:5': { label: '4:5', ratio: 4 / 5 },
  '1:1': { label: '1:1', ratio: 1 },
  '16:9': { label: '16:9', ratio: 16 / 9 },
};

/**
 * Every filter is defined twice on purpose. `css` is a real CSS filter chain
 * and is what the web build uses, so on the web these are genuine colour
 * grades. `tint` is a translucent overlay, which is the only grading React
 * Native can do on a video without a GPU pipeline — and it is what the phone
 * uses. Both paths give each preset its own recognisable look.
 */
export const FILTERS: Record<FilterId, { label: string; css: string; tint: string | null; tintOpacity: number }> = {
  none: { label: 'None', css: 'none', tint: null, tintOpacity: 0 },
  vivid: { label: 'Vivid', css: 'saturate(1.5) contrast(1.12)', tint: '#ff2e63', tintOpacity: 0.05 },
  warm: { label: 'Warm', css: 'sepia(0.28) saturate(1.2) hue-rotate(-8deg)', tint: '#ff9a3c', tintOpacity: 0.14 },
  cool: { label: 'Cool', css: 'saturate(0.95) hue-rotate(12deg) brightness(1.03)', tint: '#3ca8ff', tintOpacity: 0.14 },
  mono: { label: 'Mono', css: 'grayscale(1)', tint: '#9aa0a6', tintOpacity: 0.28 },
  noir: { label: 'Noir', css: 'grayscale(1) contrast(1.5) brightness(0.92)', tint: '#000000', tintOpacity: 0.3 },
  fade: { label: 'Fade', css: 'contrast(0.85) saturate(0.8) brightness(1.06)', tint: '#f2e6d8', tintOpacity: 0.16 },
  sunset: { label: 'Sunset', css: 'saturate(1.3) hue-rotate(-16deg) contrast(1.05)', tint: '#ff5f1f', tintOpacity: 0.2 },
  mint: { label: 'Mint', css: 'saturate(1.1) hue-rotate(48deg) brightness(1.02)', tint: '#2ee6a8', tintOpacity: 0.16 },
  dusk: { label: 'Dusk', css: 'saturate(0.9) hue-rotate(-24deg) brightness(0.95) contrast(1.1)', tint: '#4b2ea8', tintOpacity: 0.22 },
};

export const FILTER_ORDER: FilterId[] = [
  'none', 'vivid', 'warm', 'cool', 'mono', 'noir', 'fade', 'sunset', 'mint', 'dusk',
];

export const CAPTION_COLORS = ['#ffffff', '#000000', '#ffd166', '#ff5f8f', '#7ee0c4', '#8ab4ff', '#ff8b5e'];

/**
 * One editor for every surface, but each place caps it sensibly. A Moment is a
 * glance and must not turn into a short film; a post and a Circle message have
 * more room to speak.
 */
export const EDIT_LIMITS: Record<EditCategory, { maxSeconds: number; maxCaptions: number; maxStickers: number; note: string }> = {
  moment: {
    maxSeconds: 60,
    maxCaptions: 4,
    maxStickers: 6,
    note: 'A Moment clip can be up to one minute, and disappears tomorrow.',
  },
  vibe: {
    maxSeconds: 30,
    maxCaptions: 8,
    maxStickers: 12,
    note: 'A Vibe is a short clip. Thirty seconds, then it lives two weeks.',
  },
  post: {
    maxSeconds: 60,
    maxCaptions: 12,
    maxStickers: 16,
    note: 'A post can carry a minute.',
  },
  circle: {
    maxSeconds: 60,
    maxCaptions: 12,
    maxStickers: 16,
    note: 'A minute is long enough to say it to a room.',
  },
};

export const CATEGORY_LABEL: Record<EditCategory, string> = {
  moment: 'Moment',
  vibe: 'Vibe',
  post: 'Flow',
  circle: 'Circle',
};

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq.toString(36)}`;
}

export function emptyEdit(sourceDuration: number): VideoEdit {
  const d = Math.max(0, sourceDuration || 0);
  return {
    version: 1,
    sourceDuration: d,
    trimStart: 0,
    trimEnd: d,
    speed: 1,
    aspect: 'original',
    filter: 'none',
    brightness: 0,
    contrast: 0,
    saturation: 0,
    captions: [],
    stickers: [],
    music: null,
    clipVolume: 1,
    segments: [{ id: 'whole', start: 0, end: d }],
  };
}

/** The pieces this edit keeps. An edit written before timelines reads as one. */
export function segmentsOf(edit: VideoEdit): Segment[] {
  const segs = edit.segments;
  if (Array.isArray(segs) && segs.length) return segs;
  return [{ id: 'whole', start: Math.max(0, edit.trimStart ?? 0), end: Math.max(0, edit.trimEnd ?? 0) }];
}

/** Seconds kept, after cutting. */
export function clipLength(edit: VideoEdit): number {
  return durationOf(segmentsOf(edit));
}

/**
 * The frame on disk to show at a point in the finished clip.
 *
 * Cut time and source time are the same thing only while the timeline is one
 * unbroken piece; this is the one function that knows the difference.
 */
export function sourceTimeAt(edit: VideoEdit, cutTime: number): number {
  return sourceAt(segmentsOf(edit), cutTime);
}

/** Where a frame of the file has ended up, or null when it was cut away. */
export function cutTimeOfSource(edit: VideoEdit, sourceTime: number): number | null {
  return cutTimeAt(segmentsOf(edit), sourceTime);
}

/** Seconds the finished clip actually runs for, after speed. */
export function playbackLength(edit: VideoEdit): number {
  return clipLength(edit) / (edit.speed || 1);
}

export function isEdited(edit: VideoEdit): boolean {
  const segs = segmentsOf(edit);
  const cut =
    segs.length > 1 ||
    segs[0].start > 0.001 ||
    segs[segs.length - 1].end < (edit.sourceDuration || 0) - 0.001;
  return (
    cut ||
    edit.speed !== 1 ||
    edit.aspect !== 'original' ||
    edit.filter !== 'none' ||
    edit.brightness !== 0 ||
    edit.contrast !== 0 ||
    edit.saturation !== 0 ||
    edit.captions.length > 0 ||
    edit.stickers.length > 0 ||
    edit.music !== null ||
    edit.clipVolume !== 1
  );
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
}

/**
 * Force an edit into what its category allows. Called on load, on category
 * change and before export, so an edit can never be longer than the surface it
 * was made for — including one made before the limit was lowered.
 */
export function clampEdit(edit: VideoEdit, category: EditCategory): VideoEdit {
  const limit = EDIT_LIMITS[category];
  const total = Math.max(0, edit.sourceDuration || 0);
  const cap = Math.min(limit.maxSeconds, Math.max(MIN_SEGMENT, total || limit.maxSeconds));

  // Everything written before the timeline existed sets a trim window and
  // nothing else, and plenty of code still builds an edit that way. When those
  // two numbers describe a window the whole-file timeline does not, the window
  // wins — once, at the moment the edit is normalised — and after that the
  // pieces are the truth. A timeline that has actually been cut is never
  // second-guessed.
  const raw = segmentsOf(edit);
  const untouched =
    raw.length === 1 && raw[0].start <= 0.001 && raw[0].end >= Math.max(0, (total || raw[0].end) - 0.001);
  const windowDiffers =
    !!total &&
    (Math.abs((edit.trimStart ?? 0) - raw[0].start) > 0.001 ||
      Math.abs((edit.trimEnd ?? total) - raw[0].end) > 0.001);
  const source = untouched && windowDiffers ? [{ ...raw[0], start: edit.trimStart, end: edit.trimEnd }] : raw;

  // Pieces are forced inside the file, given a length, and then the sequence is
  // cut back to the ceiling for this surface — from the end, because the end is
  // where an over-long edit is least missed.
  const fitted: Segment[] = source.map((s, i) => {
    const start = clamp(snapFrame(s.start), 0, Math.max(0, total - MIN_SEGMENT));
    const end = clamp(snapFrame(s.end), start + MIN_SEGMENT, total || start + MIN_SEGMENT);
    return { id: s.id || `p${i}`, start, end: Math.max(start + MIN_SEGMENT, end) };
  });

  const kept: Segment[] = [];
  let budget = cap;
  for (const s of fitted) {
    if (budget < MIN_SEGMENT) break;
    const room = Math.min(lengthOf(s), budget);
    kept.push({ ...s, end: s.start + Math.max(MIN_SEGMENT, room) });
    budget -= room;
  }
  const segments = kept.length ? kept : [{ id: 'whole', start: 0, end: Math.min(total || MIN_SEGMENT, cap) }];

  const width = durationOf(segments);
  const bounds = {
    trimStart: segments[0].start,
    trimEnd: segments[segments.length - 1].end,
  };

  return {
    ...edit,
    version: 1,
    ...bounds,
    segments,
    speed: SPEEDS.includes(edit.speed as (typeof SPEEDS)[number]) ? edit.speed : 1,
    filter: edit.filter in FILTERS ? edit.filter : 'none',
    brightness: clamp(edit.brightness, -1, 1),
    contrast: clamp(edit.contrast, -1, 1),
    saturation: clamp(edit.saturation, -1, 1),
    clipVolume: clamp(edit.clipVolume, 0, 1),
    captions: clampOverlays(
      edit.captions.slice(0, limit.maxCaptions).map((c) => ({
        ...c,
        x: clamp(c.x, 0.04, 0.96),
        y: clamp(c.y, 0.04, 0.96),
        size: clamp(c.size, 0.02, 0.14),
      })),
      width,
    ),
    stickers: clampOverlays(
      edit.stickers.slice(0, limit.maxStickers).map((s) => ({
        ...s,
        x: clamp(s.x, 0.04, 0.96),
        y: clamp(s.y, 0.04, 0.96),
        scale: clamp(s.scale, 0.4, 2.4),
      })),
      width,
    ),
  };
}

/**
 * Move the trim window without letting it collapse or run past the file.
 *
 * With a timeline, "the trim window" means both ends of the sequence: the
 * handle at the left moves the head of the first piece, the handle at the right
 * moves the tail of the last one. Everything in between is left where you put
 * it, because a cut you made is not a thing a range slider should undo.
 */
export function setTrim(edit: VideoEdit, start: number, end: number, category: EditCategory): VideoEdit {
  const limit = EDIT_LIMITS[category];
  const cap = Math.min(limit.maxSeconds, Math.max(MIN_SEGMENT, edit.sourceDuration || limit.maxSeconds));
  const total = edit.sourceDuration || 0;
  const segs = segmentsOf(edit).map((s) => ({ ...s }));

  let s0 = clamp(start, 0, Math.max(0, total - MIN_SEGMENT));
  let e0 = clamp(end, s0 + MIN_SEGMENT, total || s0 + MIN_SEGMENT);

  if (segs.length === 1) {
    const keep = Math.min(e0 - s0, cap);
    segs[0] = { ...segs[0], start: s0, end: s0 + Math.max(MIN_SEGMENT, keep) };
  } else {
    const head = segs[0];
    const tail = segs[segs.length - 1];
    head.start = clamp(s0, head.start - (lengthOf(head) - MIN_SEGMENT), head.end - MIN_SEGMENT);
    head.end = Math.max(head.start + MIN_SEGMENT, head.end);
    tail.end = Math.max(tail.start + MIN_SEGMENT, e0);
  }

  return clampEdit({ ...edit, segments: segs }, category);
}

/* ------------------------------------------------------------- the timeline
 *
 * Five operations, each of them a pure function from an edit to a new edit.
 * They all go through clampEdit, because a cut is only correct if the result
 * is still a valid edit — and the editor should never be able to hold one that
 * is not.
 */

/** Cut at the playhead. Returns the same edit when there is nothing to cut. */
export function splitEdit(edit: VideoEdit, cutTime: number, category: EditCategory): VideoEdit {
  const next = splitAt(segmentsOf(edit), snapFrame(cutTime));
  if (next === segmentsOf(edit)) return edit;
  return clampEdit({ ...edit, segments: next }, category);
}

/** Take a piece out. The timeline always keeps at least one. */
export function removePiece(edit: VideoEdit, id: string, category: EditCategory): VideoEdit {
  const segs = segmentsOf(edit);
  const next = removeSegment(segs, id);
  if (next === segs) return edit;
  return clampEdit({ ...edit, segments: next }, category);
}

/** Put a copy of a piece next to itself. */
export function duplicatePiece(edit: VideoEdit, id: string, category: EditCategory): VideoEdit {
  return clampEdit({ ...edit, segments: duplicateSegment(segmentsOf(edit), id) }, category);
}

/** Move a piece one place along. */
export function movePiece(edit: VideoEdit, id: string, by: -1 | 1, category: EditCategory): VideoEdit {
  const segs = segmentsOf(edit);
  const next = moveSegment(segs, id, by);
  if (next === segs) return edit;
  return clampEdit({ ...edit, segments: next }, category);
}

/** Change what part of the file one piece shows. */
export function trimPiece(
  edit: VideoEdit,
  id: string,
  start: number,
  end: number,
  category: EditCategory,
): VideoEdit {
  return clampEdit({ ...edit, segments: trimSegment(segmentsOf(edit), id, start, end) }, category);
}

/** The pieces, without the mirrors — what the timeline UI draws. */
export function piecesOf(edit: VideoEdit): Segment[] {
  return segmentsOf(edit);
}

export function newCaption(edit: VideoEdit, at = 0): Caption {
  const width = clipLength(edit);
  const start = clamp(at, 0, Math.max(0, width - 1));
  return {
    id: uid('cap'),
    text: '',
    x: 0.5,
    y: 0.78,
    start,
    end: clamp(start + Math.min(3, Math.max(1, width - start)), 0, width),
    size: 0.06,
    color: '#ffffff',
    style: 'none',
    animation: 'none',
    bold: true,
  };
}

export function newSticker(edit: VideoEdit, glyph: string, at = 0): Sticker {
  const width = clipLength(edit);
  const start = clamp(at, 0, Math.max(0, width - 1));
  return {
    id: uid('stk'),
    glyph,
    x: 0.5,
    y: 0.42,
    start,
    end: width,
    scale: 1,
    rotation: 0,
  };
}

/** Overlays visible at `clipTime`. */
export function overlaysAt(
  edit: VideoEdit,
  clipTime: number,
): { captions: Caption[]; stickers: Sticker[] } {
  return {
    captions: edit.captions.filter((c) => clipTime >= c.start && clipTime < c.end),
    stickers: edit.stickers.filter((s) => clipTime >= s.start && clipTime < s.end),
  };
}

/**
 * How far through an overlay's own life we are, 0..1. Drives the entrance and
 * exit of every animation, so they stay in step no matter how long the overlay
 * is on screen for.
 */
export function overlayProgress(o: { start: number; end: number }, clipTime: number): number {
  const span = o.end - o.start;
  if (span <= 0) return 1;
  return clamp((clipTime - o.start) / span, 0, 1);
}

/** Opacity and scale for an animated overlay at a point in its life. */
export function animate(
  animation: CaptionAnimation,
  progress: number,
): { opacity: number; scale: number; translateY: number } {
  const IN = 0.16;
  const OUT = 0.16;
  const inA = Math.min(1, progress / IN);
  const outA = Math.min(1, (1 - progress) / OUT);
  const edge = Math.min(inA, outA);

  switch (animation) {
    case 'fade':
      return { opacity: edge, scale: 1, translateY: 0 };
    case 'pop':
      return { opacity: edge, scale: 0.82 + 0.18 * edge, translateY: 0 };
    case 'slide':
      return { opacity: edge, scale: 1, translateY: (1 - edge) * 0.06 };
    case 'none':
    default:
      return { opacity: 1, scale: 1, translateY: 0 };
  }
}

/** CSS filter string for the web player, or 'none'. */
export function cssFilterFor(edit: VideoEdit): string {
  const parts: string[] = [];
  const f = FILTERS[edit.filter] ?? FILTERS.none;
  if (f.css !== 'none') parts.push(f.css);
  if (edit.brightness !== 0) parts.push(`brightness(${(1 + edit.brightness * 0.5).toFixed(3)})`);
  if (edit.contrast !== 0) parts.push(`contrast(${(1 + edit.contrast * 0.5).toFixed(3)})`);
  if (edit.saturation !== 0) parts.push(`saturate(${(1 + edit.saturation * 0.6).toFixed(3)})`);
  return parts.length ? parts.join(' ') : 'none';
}

/** The overlay React Native stacks over the video to approximate the grade. */
export function tintFor(edit: VideoEdit): { color: string; opacity: number } | null {
  const f = FILTERS[edit.filter] ?? FILTERS.none;
  const base = f.tint ? { color: f.tint, opacity: f.tintOpacity } : null;

  // Brightness is the one adjustment an overlay can carry honestly: a black
  // veil dims, a white one lifts. Contrast and saturation cannot be faked this
  // way, so on the phone they are left to the CSS path on web.
  const lift = edit.brightness;
  if (lift > 0.01) {
    return base
      ? { color: base.color, opacity: base.opacity }
      : { color: '#ffffff', opacity: lift * 0.28 };
  }
  if (lift < -0.01) {
    return { color: '#000000', opacity: Math.max(base?.opacity ?? 0, -lift * 0.34) };
  }
  return base;
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const whole = Math.floor(s);
  const cs = Math.floor((s - whole) * 100);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function serializeEdit(edit: VideoEdit): string {
  return JSON.stringify(edit);
}

/** Tolerant on purpose: an edit saved by an older build must still open. */
export function parseEdit(json: string | null | undefined): VideoEdit | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as Partial<VideoEdit>;
    if (typeof raw !== 'object' || raw === null) return null;
    if (typeof raw.sourceDuration !== 'number' || !Number.isFinite(raw.sourceDuration)) return null;
    const base = emptyEdit(raw.sourceDuration);
    const rawSegments = Array.isArray(raw.segments) ? raw.segments : null;
    // An edit saved before timelines existed carries only a trim window, so
    // that window becomes its single piece. Nothing is lost, nothing is guessed.
    const segments: Segment[] = rawSegments?.length
      ? rawSegments.map((s, i) => ({
          id: typeof s?.id === 'string' ? s.id : `p${i}`,
          start: Number(s?.start) || 0,
          end: Number(s?.end) || 0,
        }))
      : [
          {
            id: 'whole',
            start: Number(raw.trimStart) || 0,
            end: Number(raw.trimEnd) || raw.sourceDuration,
          },
        ];
    return {
      ...base,
      ...raw,
      version: 1,
      segments,
      trimStart: segments[0].start,
      trimEnd: segments[segments.length - 1].end,
      captions: Array.isArray(raw.captions) ? raw.captions : [],
      stickers: Array.isArray(raw.stickers) ? raw.stickers : [],
      music: raw.music ?? null,
    } as VideoEdit;
  } catch {
    return null;
  }
}

/**
 * The seam for a real encoder.
 *
 * Today this hands back the source clip and the edit side by side, and the
 * player does the work at playback. The day we ship an encoder on the phone,
 * this is the only function that changes — it returns a new file, and every
 * caller keeps treating the result as "the clip to upload".
 */
export type EditExport = {
  /** Where the clip to upload lives. Today: the untouched source. */
  uri: string;
  /** The recipe to store beside it. Empty on the day we burn edits in. */
  edit: VideoEdit | null;
};

export function exportEdit(sourceUri: string, edit: VideoEdit, category: EditCategory): EditExport {
  const clamped = clampEdit(edit, category);
  return { uri: sourceUri, edit: isEdited(clamped) ? clamped : null };
}

/**
 * What actually gets uploaded once a clip has been encoded.
 *
 * `baked` is the work order handed to the encoder on the device. `live` is what
 * we keep afterwards: only the words, so they stay editable for the window, and
 * null when there are none to keep.
 */
export function splitForUpload(
  edit: VideoEdit,
  category: EditCategory,
): { baked: BakedEdit; live: LiveEdit | null } {
  const clamped = clampEdit(edit, category);
  const { captions, stickers, ...baked } = clamped;
  const look = lookOf(clamped);
  const worthSending = captions.length > 0 || stickers.length > 0 || !looksNeutral(look);

  return {
    baked,
    live: worthSending ? { version: 2, captions, stickers, look } : null,
  };
}

/* ------------------------------------------------------------------ the split
 *
 * Once a clip is encoded, two very different things exist.
 *
 * One edit happens to the file itself: the cut. It is the only one that makes
 * the clip smaller, and it is why a trimmed clip is genuinely shorter on disk.
 * It can never be changed again — the video that would be needed to re-cut it
 * is gone.
 *
 * Everything else travels as data and is reproduced by the player: your words,
 * your stickers, and the look — the filter, the light, the shape of the frame,
 * the speed and the sound. None of that is written into the pixels, which is
 * what makes it possible at all on a phone that has no encoder, and what keeps
 * the promise that the picture is final but what you wrote is not.
 */

export type LiveEdit = {
  version: 2;
  captions: Caption[];
  stickers: Sticker[];
  /**
   * The look: everything the player can reproduce without touching the file.
   *
   * This travels as data for one reason — the picture has to match what was
   * previewed. An encoder may or may not be present on the phone, and a clip
   * posted without one must still look the way its author made it.
   */
  look: Look;
  /**
   * The pieces of the file this clip is made of — **only present when the file
   * itself was not cut.**
   *
   * The cut is normally the one edit written into the file, because it is the
   * one that makes the clip smaller. When there is no encoder to do that (the
   * web build, or a phone without the native module), the cut still has to
   * survive — otherwise everything a person cut out is still in the clip they
   * posted, and the trim was a lie. So it travels as data instead, and the
   * player honours it exactly as the editor previewed it.
   *
   * Absence means "the file is already the clip", which is the normal case.
   */
  cuts?: Segment[];
};

/**
 * How the clip looks, as opposed to what it says.
 *
 * A filter, the light, the shape of the frame, the speed and the sound. All of
 * it can be reproduced by the player at playback time, so all of it is stored
 * as data rather than being written into the pixels.
 *
 * The cut is the exception and is deliberately absent: that is the one edit
 * that has to happen to the file itself, because it is the only one that makes
 * the file smaller.
 */
export type Look = {
  filter: FilterId;
  brightness: number;
  contrast: number;
  saturation: number;
  aspect: AspectId;
  speed: number;
  /** The clip's own audio, or 0 when it was muted. */
  clipVolume: number;
  music: MusicTrack | null;
};

/** The look of a clip nobody has touched. */
export const NEUTRAL_LOOK: Look = {
  filter: 'none',
  brightness: 0,
  contrast: 0,
  saturation: 0,
  aspect: 'original',
  speed: 1,
  clipVolume: 1,
  music: null,
};

/** The look one edit asks for. */
export function lookOf(edit: VideoEdit): Look {
  return {
    filter: edit.filter,
    brightness: edit.brightness,
    contrast: edit.contrast,
    saturation: edit.saturation,
    aspect: edit.aspect,
    speed: edit.speed,
    clipVolume: edit.clipVolume,
    music: edit.music,
  };
}

/** Whether a look changes anything at all. */
export function looksNeutral(look: Look): boolean {
  return (
    look.filter === 'none' &&
    look.brightness === 0 &&
    look.contrast === 0 &&
    look.saturation === 0 &&
    look.aspect === 'original' &&
    look.speed === 1 &&
    look.clipVolume === 1 &&
    !look.music
  );
}

/** A look read back from storage, where an older clip has none recorded. */
export function readLook(raw: Partial<Look> | null | undefined): Look {
  if (!raw || typeof raw !== 'object') return NEUTRAL_LOOK;
  const music = raw.music ?? null;
  return {
    filter: raw.filter ?? 'none',
    brightness: num(raw.brightness, 0),
    contrast: num(raw.contrast, 0),
    saturation: num(raw.saturation, 0),
    aspect: raw.aspect ?? 'original',
    speed: num(raw.speed, 1) || 1,
    clipVolume: num(raw.clipVolume, 1),
    music: music && typeof music.uri === 'string' ? music : null,
  };
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * Everything the encoder must write into the file before upload.
 *
 * Captions and stickers are absent here on purpose: they are emoji and text the
 * app draws, with no pixels of their own to burn in, so they travel as data and
 * are drawn by the player instead.
 */
export type BakedEdit = Omit<VideoEdit, 'captions' | 'stickers'>;

/**
 * How long a clip stays editable after posting. Fifteen minutes is long enough
 * to catch a mistake in your words and short enough that nobody watches a clip
 * change under them hours later.
 */
export const EDIT_WINDOW_MS = 15 * 60 * 1000;

export function editWindowClosesAt(createdAt: number): number {
  return createdAt + EDIT_WINDOW_MS;
}

export function canEditAt(createdAt: number, now: number = Date.now()): boolean {
  return now - createdAt <= EDIT_WINDOW_MS;
}

export function editWindowRemaining(createdAt: number, now: number = Date.now()): number {
  return Math.max(0, editWindowClosesAt(createdAt) - now);
}

/**
 * Whether this timeline actually cuts anything out — a trim at either end
 * counts, and so does any hole in the middle.
 */
export function hasCut(edit: VideoEdit): boolean {
  const segs = segmentsOf(edit);
  const total = edit.sourceDuration || 0;
  if (!segs.length) return false;

  // A hole is the clearest cut there is: two pieces that were not next to each
  // other in the file. Pieces that simply touch are one run, and removing a cut
  // is not a thing you can do — so two touching pieces are not a cut at all.
  for (let i = 1; i < segs.length; i++) {
    if (Math.abs(segs[i].start - segs[i - 1].end) > 0.02) return true;
  }
  return segs[0].start > 0.05 || (total > 0 && segs[segs.length - 1].end < total - 0.05);
}

/** The cut, as data, for a clip whose file could not be cut. */
export function liveWithCuts(live: LiveEdit | null, edit: VideoEdit): LiveEdit | null {
  if (!hasCut(edit)) return live;
  const cuts = segmentsOf(edit).map((s) => ({ ...s }));
  return live
    ? { ...live, cuts }
    : { version: 2, captions: [], stickers: [], look: lookOf(edit), cuts };
}

/** The part that is kept after encoding and can still be changed. */
export function toLiveEdit(edit: VideoEdit): LiveEdit {
  return { version: 2, captions: edit.captions, stickers: edit.stickers, look: lookOf(edit) };
}

export function hasLiveEdits(live: LiveEdit | null): boolean {
  return !!live && (live.captions.length > 0 || live.stickers.length > 0 || !looksNeutral(live.look));
}

export function parseLiveEdit(json: string | null | undefined): LiveEdit | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as Partial<LiveEdit>;
    if (!raw || typeof raw !== 'object') return null;
    return {
      version: 2,
      captions: Array.isArray(raw.captions) ? raw.captions : [],
      stickers: Array.isArray(raw.stickers) ? raw.stickers : [],
      // A clip stored before the look travelled simply has none, and is played
      // back as it was recorded.
      look: readLook(raw.look),
      // The cut travels as data only when the file could not be cut. Anything
      // unreadable here means "no cuts", which falls back to playing the file.
      ...(Array.isArray(raw.cuts) && raw.cuts.length
        ? {
            cuts: raw.cuts
              .filter((c) => c && Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start)
              .map((c, i) => ({ id: typeof c.id === 'string' ? c.id : `c${i}`, start: c.start, end: c.end })),
          }
        : {}),
    };
  } catch {
    return null;
  }
}

/**
 * A whole edit rebuilt from a live half, for when somebody reopens a posted clip
 * inside its window. The video settings come back as "already applied" and stay
 * locked; only the words come back editable.
 */
export function editFromLive(live: LiveEdit | null, sourceDuration: number): VideoEdit {
  const base = emptyEdit(sourceDuration);
  if (!live) return base;
  return { ...base, captions: live.captions, stickers: live.stickers, ...live.look };
}
