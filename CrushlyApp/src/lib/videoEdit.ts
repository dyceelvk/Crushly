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
    maxSeconds: 15,
    maxCaptions: 4,
    maxStickers: 6,
    note: 'Moments are a glance — fifteen seconds, and gone tomorrow.',
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
  };
}

/** Seconds kept after trimming. */
export function clipLength(edit: VideoEdit): number {
  return Math.max(0, edit.trimEnd - edit.trimStart);
}

/** Seconds the finished clip actually runs for, after speed. */
export function playbackLength(edit: VideoEdit): number {
  return clipLength(edit) / (edit.speed || 1);
}

export function isEdited(edit: VideoEdit): boolean {
  return (
    edit.trimStart > 0.001 ||
    edit.trimEnd < edit.sourceDuration - 0.001 ||
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
  const cap = Math.min(limit.maxSeconds, Math.max(1, edit.sourceDuration || limit.maxSeconds));

  let trimStart = clamp(edit.trimStart, 0, Math.max(0, (edit.sourceDuration || 0) - 0.2));
  let trimEnd = clamp(edit.trimEnd, trimStart + 0.2, edit.sourceDuration || trimStart + 0.2);

  if (trimEnd - trimStart > cap) {
    // Keep the head of the clip; that is where people start talking.
    trimEnd = Math.min(trimEnd, trimStart + cap);
    if (trimEnd - trimStart > cap) trimStart = trimEnd - cap;
  }

  const width = trimEnd - trimStart;
  return {
    ...edit,
    version: 1,
    trimStart,
    trimEnd,
    speed: SPEEDS.includes(edit.speed as (typeof SPEEDS)[number]) ? edit.speed : 1,
    filter: edit.filter in FILTERS ? edit.filter : 'none',
    brightness: clamp(edit.brightness, -1, 1),
    contrast: clamp(edit.contrast, -1, 1),
    saturation: clamp(edit.saturation, -1, 1),
    clipVolume: clamp(edit.clipVolume, 0, 1),
    captions: edit.captions.slice(0, limit.maxCaptions).map((c) => ({
      ...c,
      x: clamp(c.x, 0.04, 0.96),
      y: clamp(c.y, 0.04, 0.96),
      size: clamp(c.size, 0.02, 0.14),
      start: clamp(c.start, 0, width),
      end: clamp(c.end, 0, width),
    })),
    stickers: edit.stickers.slice(0, limit.maxStickers).map((s) => ({
      ...s,
      x: clamp(s.x, 0.04, 0.96),
      y: clamp(s.y, 0.04, 0.96),
      scale: clamp(s.scale, 0.4, 2.4),
      start: clamp(s.start, 0, width),
      end: clamp(s.end, 0, width),
    })),
  };
}

/** Move the trim window without letting it collapse or run past the file. */
export function setTrim(edit: VideoEdit, start: number, end: number, category: EditCategory): VideoEdit {
  const limit = EDIT_LIMITS[category];
  const cap = Math.min(limit.maxSeconds, Math.max(1, edit.sourceDuration || limit.maxSeconds));
  const total = edit.sourceDuration || 0;

  let s = clamp(start, 0, Math.max(0, total - 0.2));
  let e = clamp(end, s + 0.2, total || s + 0.2);
  if (e - s > cap) e = s + cap;

  // Overlays live in clip time, so a shorter window has to carry them with it.
  const width = e - s;
  return {
    ...edit,
    trimStart: s,
    trimEnd: e,
    captions: edit.captions.map((c) => ({ ...c, start: clamp(c.start, 0, width), end: clamp(c.end, 0, width) })),
    stickers: edit.stickers.map((k) => ({ ...k, start: clamp(k.start, 0, width), end: clamp(k.end, 0, width) })),
  };
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
    return {
      ...base,
      ...raw,
      version: 1,
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

/**
 * The frame a clip should be drawn in, given the column it sits in and the
 * source's own pixel size.
 *
 * This is the arithmetic behind "the video is not the size I uploaded". A feed
 * card is narrower than the phone — the list pads itself on both sides — so a
 * clip sized from the window overflows its card by that padding. And a clip
 * forced into a fixed 4:5 slot either letterboxes (a 9:16 clip loses a fifth of
 * its height to bars) or, if filled with a `cover` fit, has its sides cropped
 * and reads as zoomed in.
 *
 * The rule here is: keep the whole picture, keep the source's ratio, and never
 * exceed the column. When the natural height would overrun `maxHeight`, the
 * frame is narrowed instead of the picture being cropped.
 *
 * `ratio` is width / height (0.5625 for 9:16, 0.8 for 4:5).
 */
export function fitFrame(
  columnWidth: number,
  ratio: number,
  maxHeight?: number,
): { width: number; height: number } {
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 4 / 5;
  const w = Number.isFinite(columnWidth) && columnWidth > 0 ? columnWidth : 0;
  if (!w) return { width: 0, height: 0 };
  const naturalHeight = w / safeRatio;
  const limit = maxHeight && maxHeight > 0 ? maxHeight : Infinity;
  if (naturalHeight <= limit) {
    return { width: Math.round(w), height: Math.round(naturalHeight) };
  }
  const h = Math.round(limit);
  return { width: Math.round(h * safeRatio), height: h };
}
