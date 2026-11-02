/**
 * Turning an edit into a smaller file.
 *
 * This module has two jobs. The first is planning: `planEncode` turns a baked
 * edit into the exact FFmpeg arguments that produce it. That part is pure, has
 * no platform in it, and is tested directly — it is the substance of the whole
 * feature and the bit most likely to be wrong.
 *
 * The second is running that plan, which is where the platform shows up. The
 * encoder lives on the device, so this layer asks whether one is present and
 * falls back honestly when it is not. The fallback is not a silent downgrade:
 * it reports `encoded: false`, and the clip is uploaded whole with its recipe
 * instead — which is correct, just not smaller.
 *
 * Why the fallback exists at all: shipping an encoder means shipping native
 * code, and the app must never be unable to post because of it.
 */

import {
  BakedEdit, EDIT_LIMITS, EditCategory, FILTERS, LiveEdit, NEUTRAL_LOOK, VideoEdit, clipLength,
  liveWithCuts, segmentsOf, splitForUpload,
} from './videoEdit';
import { Segment, lengthOf } from './timeline';

/**
 * The ranges of the file the timeline keeps, in order.
 *
 * A single range is a trim and can be done with a seek. Anything else is a
 * *join*: pieces of the file that were not next to each other have to be cut
 * out one by one and stuck back together, which is a different operation
 * entirely — and the reason `planEncode` has two shapes.
 */
export function keptRanges(baked: BakedEdit): Segment[] {
  const all = segmentsOf(baked as unknown as VideoEdit);
  const segs = all.filter((s) => lengthOf(s) > 0.01);
  const whole =
    segs.length === 1 &&
    segs[0].start <= 0.01 &&
    segs[0].end >= Math.max(0, baked.sourceDuration) - 0.01;

  // An edit written before the timeline existed carries a trim window instead
  // of pieces. It means the same thing, so it is read as one piece.
  if (whole && (baked.trimStart > 0.01 || baked.trimEnd < baked.sourceDuration - 0.01)) {
    return [{ id: segs[0].id, start: baked.trimStart, end: Math.min(baked.trimEnd, baked.sourceDuration) }];
  }
  if (segs.length) return segs;
  return [{ id: 'whole', start: 0, end: Math.max(0, baked.sourceDuration) }];
}

/** True when the kept pieces are one unbroken run of the file. */
export function isContiguous(ranges: Segment[]): boolean {
  if (ranges.length <= 1) return true;
  for (let i = 1; i < ranges.length; i++) {
    if (Math.abs(ranges[i].start - ranges[i - 1].end) > 0.02) return false;
  }
  return true;
}

/**
 * The trimmer is reached by dynamic import, never at load time.
 *
 * `planEncode` — the substance of this module — is tested in plain node, where
 * React Native is not loaded. A static import of the native module would take
 * the whole test file down with it.
 */

/** Longest edge we keep, per category. Short-lived clips do not need 4K. */
const MAX_EDGE: Record<EditCategory, number> = {
  moment: 720,
  vibe: 720,
  post: 1080,
  circle: 720,
};

/**
 * Filter presets as FFmpeg filters.
 *
 * These are approximations of the tints the app shows, not the same maths — a
 * preview drawn by a compositor and a grade computed by a filter chain will
 * never match exactly. They are chosen to read as the same look.
 */
const FILTER_CHAIN: Record<keyof typeof FILTERS, string> = {
  none: '',
  vivid: 'eq=saturation=1.35:contrast=1.10',
  warm: 'eq=saturation=1.15:brightness=0.02,colorbalance=rs=0.08:bs=-0.08',
  cool: 'eq=saturation=1.05,colorbalance=rs=-0.08:bs=0.08',
  mono: 'hue=s=0',
  noir: 'hue=s=0,eq=contrast=1.40:brightness=-0.06',
  fade: 'eq=contrast=0.85:brightness=0.05:saturation=0.85',
  sunset: 'eq=saturation=1.25:brightness=0.03,colorbalance=rs=0.10:bs=-0.05',
  mint: 'eq=saturation=1.15,colorbalance=rs=-0.05:gs=0.05:bs=0.05',
  dusk: 'eq=brightness=-0.04:contrast=1.10:saturation=0.90,colorbalance=rs=0.04:bs=0.08',
};

/** atempo only accepts 0.5–2.0 and cannot be chained outside it; our speeds fit. */
function atempoFor(speed: number): string[] {
  return speed === 1 ? [] : [`atempo=${speed}`];
}

export type EncodePlan = {
  args: string[];
  /** Plain-English lines for the "processing" screen. */
  steps: string[];
  /** True when there is nothing for the encoder to do. */
  noop: boolean;
};

export function planEncode(
  baked: BakedEdit,
  opts: { input: string; output: string; music?: string | null; category?: EditCategory },
): EncodePlan {
  const category = opts.category ?? 'post';
  const cap = MAX_EDGE[category];
  const length = clipLength(baked as unknown as VideoEdit);
  const steps: string[] = [];
  const music = opts.music ?? null;
  const ranges = keptRanges(baked);
  const joined = ranges.length > 1;

  const args: string[] = ['-y'];

  // Seeking before -i lets FFmpeg skip decoding the part we cut away, which is
  // most of the speed on a long clip. It only works for one unbroken range —
  // a join needs every piece decoded, so those are cut in the filter graph
  // instead.
  if (!joined && baked.trimStart > 0.01) {
    args.push('-ss', trim(ranges[0].start));
    steps.push(`Start at ${ranges[0].start.toFixed(1)}s`);
  }
  if (!joined && length > 0) args.push('-t', trim(lengthOf(ranges[0])));
  args.push('-i', opts.input);

  if (music) {
    args.push('-ss', trim(baked.music?.offset ?? 0));
    args.push('-i', music);
    steps.push('Mix in your sound');
  }

  if (joined) {
    steps.push(`Join ${ranges.length} pieces`);
  }

  const vf: string[] = [];
  const ratio = aspectRatio(baked.aspect);

  if (ratio) {
    // Grow to cover the frame, then cut to the exact shape. Doing it in this
    // order is what keeps the picture filling the frame instead of letterboxing.
    vf.push(`scale='if(gte(a,${ratio}),${cap},-2)':'if(gte(a,${ratio}),-2,${cap})'`);
    vf.push(`crop='min(iw,ih*${ratio})':'min(ih,iw/${ratio})'`);
    steps.push(`Crop to ${baked.aspect}`);
  } else {
    vf.push(`scale='min(${cap},iw)':-2`);
  }

  if (baked.speed !== 1) {
    vf.push(`setpts=PTS/${baked.speed}`);
    steps.push(`${baked.speed}× speed`);
  }

  const preset = FILTER_CHAIN[baked.filter];
  if (preset) {
    vf.push(preset);
    steps.push(`${FILTERS[baked.filter].label} look`);
  }

  // eq's brightness, contrast and saturation all take -1..1, which is exactly
  // the range the sliders use — no conversion, no drift.
  const eq: string[] = [];
  if (baked.brightness !== 0) eq.push(`brightness=${fixed(baked.brightness * 0.5)}`);
  if (baked.contrast !== 0) eq.push(`contrast=${fixed(1 + baked.contrast * 0.5)}`);
  if (baked.saturation !== 0) eq.push(`saturation=${fixed(1 + baked.saturation * 0.6)}`);
  if (eq.length) {
    vf.push(`eq=${eq.join(':')}`);
    steps.push('Light and colour');
  }

  const af: string[] = atempoFor(baked.speed);
  if (baked.clipVolume !== 1) {
    af.push(`volume=${fixed(baked.clipVolume)}`);
    steps.push(baked.clipVolume === 0 ? 'Mute the clip' : 'Set the clip’s volume');
  }

  if (joined) {
    args.push('-filter_complex', joinGraph(ranges, vf, af, music ? fixed(baked.music?.volume ?? 0.6) : null));
    args.push('-map', '[vout]', '-map', music ? '[aout]' : '[aclip]');
  } else {
    if (vf.length) args.push('-vf', vf.join(','));
    if (af.length || music) {
      const chain = af.length ? af.join(',') : 'anull';
      if (music) {
        const mv = fixed(baked.music?.volume ?? 0.6);
        args.push(
          '-filter_complex',
          `[1:a]volume=${mv}[music];[0:a]${chain}[clip];[clip][music]amix=inputs=2:duration=first:dropout_transition=0[aout]`,
        );
        args.push('-map', '0:v:0', '-map', '[aout]');
      } else {
        args.push('-af', chain);
      }
    }
  }

  args.push(
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '26',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    opts.output,
  );

  const noop =
    !joined &&
    ranges[0].start <= 0.01 &&
    length >= baked.sourceDuration - 0.01 &&
    baked.speed === 1 &&
    baked.aspect === 'original' &&
    baked.filter === 'none' &&
    baked.brightness === 0 &&
    baked.contrast === 0 &&
    baked.saturation === 0 &&
    baked.clipVolume === 1 &&
    !music;

  return { args, steps, noop };
}

/**
 * The graph that cuts the pieces out and sticks them back together.
 *
 * `concat` wants its inputs interleaved — video n then audio n — and every
 * piece is reset to start at zero before joining, or the second piece would
 * begin at its own timestamp in the file and the join would be a jump.
 */
export function joinGraph(
  ranges: Segment[],
  vf: string[],
  af: string[],
  musicVolume: string | null,
): string {
  const parts: string[] = [];
  ranges.forEach((r, i) => {
    parts.push(`[0:v]trim=start=${trim(r.start)}:end=${trim(r.end)},setpts=PTS-STARTPTS[v${i}]`);
    parts.push(`[0:a]atrim=start=${trim(r.start)}:end=${trim(r.end)},asetpts=PTS-STARTPTS[a${i}]`);
  });

  const pairs = ranges.map((_, i) => `[v${i}][a${i}]`).join('');
  parts.push(`${pairs}concat=n=${ranges.length}:v=1:a=1[vc][ac]`);

  const video = vf.length ? `[vc]${vf.join(',')}[vout]` : '[vc]null[vout]';
  parts.push(video);

  const audio = af.length ? `[ac]${af.join(',')}[aclip]` : '[ac]anull[aclip]';
  parts.push(audio);

  if (musicVolume !== null) {
    parts.push(`[1:a]volume=${musicVolume}[music]`);
    parts.push('[aclip][music]amix=inputs=2:duration=first:dropout_transition=0[aout]');
  }
  return parts.join(';');
}

function aspectRatio(aspect: string): number | null {
  switch (aspect) {
    case '9:16': return 9 / 16;
    case '4:5': return 4 / 5;
    case '1:1': return 1;
    case '16:9': return 16 / 9;
    default: return null;
  }
}

function fixed(n: number): string {
  return (Math.round(n * 1000) / 1000).toString();
}

/** FFmpeg wants seconds; more than three decimals is noise. */
function trim(n: number): string {
  return Math.max(0, n).toFixed(3);
}

export type EncodeResult = {
  /** Where the finished file is. Equals the input when nothing was encoded. */
  uri: string;
  /** False when no encoder was present and the original was kept. */
  encoded: boolean;
  /** How it was produced, when it was. */
  via: 'lossless-trim' | 're-encode' | null;
  /** Bytes before and after, when we could measure them. */
  savedBytes: number | null;
};

/**
 * The range to keep, in milliseconds — or null when the edit keeps the whole
 * clip and there is nothing to cut.
 *
 * Half a second is the threshold. Cutting less than that off either end is not
 * worth the work or the risk of a re-mux; more than that is a real trim.
 */
export function cutRange(baked: BakedEdit): { startMs: number; endMs: number } | null {
  // A join cannot be done by copying a run of the file, so it never takes the
  // lossless path — it has to be re-encoded.
  const ranges = keptRanges(baked);
  if (ranges.length > 1) return null;

  const startMs = Math.max(0, baked.trimStart * 1000);
  const sourceMs = Math.max(0, baked.sourceDuration * 1000);
  const endMs = Math.min(baked.trimEnd * 1000, sourceMs) || sourceMs;

  const cutsStart = startMs >= 500;
  const cutsEnd = endMs > 0 && endMs <= sourceMs - 500;
  if (!cutsStart && !cutsEnd) return null;

  return {
    startMs,
    endMs: Math.max(startMs + 100, cutsEnd ? endMs : sourceMs),
  };
}

/**
 * True when the only thing the edit does is cut.
 *
 * Speed, filters, crop, light and music all change the pixels or the sound, so
 * they need a real re-encode; a plain cut does not, and it is by far the most
 * common edit.
 */
export function isTrimOnly(baked: BakedEdit): boolean {
  return (
    baked.speed === 1 &&
    baked.aspect === 'original' &&
    baked.filter === 'none' &&
    baked.brightness === 0 &&
    baked.contrast === 0 &&
    baked.saturation === 0 &&
    baked.clipVolume === 1 &&
    !baked.music
  );
}

export type Encoder = {
  available: boolean;
  run: (plan: EncodePlan, onProgress?: (fraction: number) => void) => Promise<string>;
};

/**
 * Is there an encoder on this device right now?
 *
 * The native encoder is a native module and cannot be added or removed at
 * runtime, so this is a build-time fact dressed up as a question. It is written
 * this way so that the day the module lands, only this function changes.
 */
export function encoderAvailable(): boolean {
  return false;
}

let injected: Encoder | null = null;

/** The native module calls this once on startup. Web never does. */
export function registerEncoder(e: Encoder | null): void {
  injected = e;
}

/**
 * Run the plan, or say so when we cannot.
 *
 * A clip that cannot be encoded is still posted — whole, with its recipe, which
 * plays back exactly right. It is only bigger than it needed to be.
 */
export async function encodeClip(
  sourceUri: string,
  edit: VideoEdit,
  category: EditCategory,
  opts: { music?: string | null; outputUri?: string } = {},
): Promise<EncodeResult> {
  const { captions, stickers, ...baked } = edit;
  const plan = planEncode(baked, {
    input: sourceUri,
    output: opts.outputUri ?? `${sourceUri}.edited.mp4`,
    music: opts.music ?? null,
    category,
  });

  if (plan.noop) {
    return { uri: sourceUri, encoded: false, via: null, savedBytes: null };
  }

  // A plain cut is the common case and the phone can do it without touching a
  // pixel: the encoded frames are copied straight into a shorter file, so a
  // trimmed clip is genuinely smaller than the one that was chosen.
  const cut = cutRange(baked);
  if (cut && isTrimOnly(baked)) {
    try {
      const { trimmerAvailable, trimVideo } = await import('./nativeTrim');
      if (trimmerAvailable()) {
        const uri = await trimVideo(sourceUri, cut);
        return { uri, encoded: true, via: 'lossless-trim', savedBytes: null };
      }
    } catch {
      // A failed cut must never lose somebody's clip. Fall through and post
      // the original, which is bigger but still correct.
    }
  }

  const encoder = injected;
  if (!encoder?.available) {
    return { uri: sourceUri, encoded: false, via: null, savedBytes: null };
  }

  try {
    const uri = await encoder.run(plan);
    return { uri, encoded: true, via: 're-encode', savedBytes: null };
  } catch {
    // An encode that fails must never lose somebody's clip.
    return { uri: sourceUri, encoded: false, via: null, savedBytes: null };
  }
}

/**
 * Why a clip could not be shrunk, in words a member can read. Deliberately free
 * of any platform import so it — and this whole module — can be tested in node.
 */
/**
 * Everything a composer needs in order to upload an edited clip: the file that
 * should actually be sent, and the half that travels as data.
 *
 * Callers must not upload the picked file directly. Doing so posts the whole
 * clip no matter how it was trimmed, which makes the trim a lie — and the part
 * that was cut away stays in the bucket for anyone who fetches it.
 */
export async function preparedClip(
  edit: VideoEdit | null,
  sourceUri: string | null,
  category: EditCategory,
): Promise<{ uri: string | null; live: LiveEdit | null; encoded: boolean }> {
  if (!sourceUri) return { uri: null, live: null, encoded: false };

  // No edit at all: the picked file is the finished clip.
  if (!edit) return { uri: sourceUri, live: null, encoded: false };

  const { live } = splitForUpload(edit, category);
  const result = await encodeClip(sourceUri, edit, category);

  // A re-encode writes the look into the pixels. The player must not apply it a
  // second time, so it is dropped from the half that travels as data.
  const stored = live && result.via === 're-encode' ? { ...live, look: NEUTRAL_LOOK } : live;

  // When nothing encoded, the file still has every frame in it — including the
  // ones that were cut away. The cut then has to travel as data, or the clip
  // that gets posted is the clip that was picked.
  const withCuts = result.encoded ? stored : liveWithCuts(stored, edit);

  return { uri: result.uri, live: withCuts, encoded: result.encoded };
}

export function encodeUnavailableNote(): string {
  return 'Your clip will be posted as it is.';
}

export const ENCODE_MAX_SECONDS = EDIT_LIMITS;
