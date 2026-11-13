import { Platform } from 'react-native';
import { clipCompressorAvailable, compressClipFile, NoSpaceError, removeCompressedClip } from './compressClip';

export { NoSpaceError };

/**
 * Making a big clip small enough to post.
 *
 * People record on a phone that writes about 12 Mbit/s, which is 90 MB a minute.
 * That is not a clip anybody did anything wrong with — it is just what a camera
 * does — and telling them to "trim it" is telling them the app cannot hold their
 * video. So a clip is accepted up to 300 MB and **re-encoded down** to something
 * the store and the feed can take, before a single byte is uploaded.
 *
 * The web path is a real transcode with what every browser already has: the
 * picture is drawn, frame by frame, onto a canvas at a chosen size, the canvas is
 * captured, the original's audio track is carried across, and MediaRecorder
 * writes a new file at a bitrate computed from the clip's length and the size we
 * are aiming for. Nothing is downloaded and nothing is installed.
 *
 * The phone path is the same contract with a native encoder (react-native-
 * compressor, which uses ffmpeg). It is loaded lazily: a build without it still
 * runs, and the upload says plainly that the clip must be trimmed instead of
 * pretending to compress it.
 */

/** The largest clip anyone may pick. Beyond this it is a download, not a clip. */
export const MAX_PICK_BYTES = 300 * 1024 * 1024;

/**
 * What a finished upload should weigh.
 *
 * The owner asked for "up to 300 MB in, compressing to 100 MB or so". 64 MB is
 * inside that promise and better than it: a 100 MB post takes a minute to start
 * playing on a phone's data, and nothing is lost that a phone screen can show.
 * The media store also refuses anything over its ceiling, so the target has to
 * land well under it whatever the clip.
 */
export const TARGET_BYTES = 64 * 1024 * 1024;

/** Below this there is nothing to gain, and re-encoding only loses quality. */
const LEAVE_ALONE_BYTES = 12 * 1024 * 1024;

/** Aim below the target so a container's overhead cannot push it over. */
const SAFETY = 0.92;

export type CompressedVideo = {
  blob: Blob;
  /** The type of the file that came out, which is not always the one that went in. */
  mimeType: string;
  width: number;
  height: number;
  durationMs: number;
  bytes: number;
};

export type CompressProgress = (fraction: number, label: string) => void;

/**
 * A listener for however is on screen while a clip is being made smaller.
 *
 * Compression happens inside the upload, which is called from five different
 * screens; without this each of them would have to pass a callback down through
 * the API layer to say "Compressing…". The screen that is publishing subscribes
 * for as long as it is mounted, and the upload reports to it.
 */
let listener: CompressProgress | null = null;

export function onCompressProgress(fn: CompressProgress): () => void {
  listener = fn;
  return () => { if (listener === fn) listener = null; };
}

const report = (progress: CompressProgress | undefined) => (fraction: number, label: string) => {
  progress?.(fraction, label);
  listener?.(fraction, label);
};

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/**
 * How many bits a second the picture can have.
 *
 * Audio is a fixed, small cost; everything left is spread over the clip's length.
 * The floor is 2.5 Mbit/s because below that a 1080-wide picture falls apart —
 * the old 350 kbit/s floor produced the muddy clips members reported. The ceiling
 * is 10 Mbit/s; the phone path uses the same limits via Media3 Transformer.
 */
function videoBitrateKbps(durationS: number, targetBytes: number): number {
  const totalKbps = (targetBytes * SAFETY * 8) / 1000 / Math.max(durationS, 1);
  const video = Math.round(totalKbps - AUDIO_KBPS);
  return Math.min(10000, Math.max(2500, video));
}

/** Audio is speech and music at phone size; 96 kbit/s stereo is generous. */
const AUDIO_KBPS = 96;

/** A frame rate the eye accepts for a feed, and one that keeps the bitrate honest. */
const FPS = 30;

/**
 * The width that suits the bitrate.
 *
 * Encoding 1080 pixels wide at 600 kbit/s is how a clip ends up looking worse
 * than one encoded at 640 wide: the encoder starves. Halving the width at the
 * same bitrate roughly doubles the bits per pixel, so a low budget gets a smaller
 * picture and a clean one rather than a large, muddy one.
 */
function widthFor(bitrateKbps: number, sourceW: number, sourceH: number): number {
  const cap = bitrateKbps >= 2500 ? 1080 : bitrateKbps >= 1200 ? 854 : bitrateKbps >= 700 ? 640 : 480;
  const portrait = sourceH > sourceW;
  const longest = Math.max(sourceW, sourceH) || cap;
  const want = Math.min(cap, longest);
  return even(portrait ? (want * sourceW) / sourceH : want);
}

/**
 * The first container this browser can actually record — and only one whose
 * codec is named in full.
 *
 * A bare `video/mp4` is not a promise: one Chromium build answered "supported"
 * for it and then wrote VP9 frames with an MP4 label, which is a file nothing can
 * play. So each candidate names its codecs, and the recorder's own answer
 * (`recorder.mimeType`) is what labels the result — never our guess.
 */
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/mp4;codecs=avc1.42E01E',
  'video/webm',
];

function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const type of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      /* keep looking */
    }
  }
  return '';
}

/** Whether this build carries the phone's encoder at all. */
function nativeCompressorAvailable(): boolean {
  return Platform.OS !== 'web' && clipCompressorAvailable();
}

/**
 * Re-encode a clip to fit `targetBytes`.
 *
 * Returns `null` when the clip does not need it, when the platform cannot encode,
 * or when the attempt produced something bigger than what went in — a compressor
 * that makes the file larger is not a compressor.
 */
export async function compressVideo(
  input: Blob,
  {
    targetBytes = TARGET_BYTES,
    progress,
    sourceUri,
  }: { targetBytes?: number; progress?: CompressProgress; sourceUri?: string } = {},
): Promise<CompressedVideo | null> {
  if (!input.type.startsWith('video/')) return null;
  if (input.size <= Math.min(targetBytes, LEAVE_ALONE_BYTES)) return null;

  const tell = report(progress);
  tell(0, 'Compressing your clip');
  const out = Platform.OS === 'web'
    ? await compressOnWeb(input, targetBytes, tell)
    : await compressOnDevice(input, targetBytes, { sourceUri, progress: tell });
  tell(1, 'Uploading');
  return out;
}

/**
 * How big a file on this phone is, without reading a byte of it.
 *
 * The question "can this be uploaded" used to be answered by loading the file and
 * weighing the Blob, which on a 200 MB clip is the whole problem. The filesystem
 * already knows.
 */
export async function fileSize(uri: string): Promise<number | null> {
  if (Platform.OS === 'web') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const FileSystem = require('expo-file-system/legacy') as typeof import('expo-file-system/legacy');
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists && 'size' in info ? info.size ?? null : null;
  } catch {
    return null;
  }
}

/**
 * Compress a clip straight from its path — the phone path that does not OOM.
 *
 * `compressVideo` takes a Blob because the web has nothing else. A phone does:
 * the picker hands over a file, and the native encoder reads that file. So a
 * 300 MB clip is never turned into a Blob at all, and the 64 MB result is the
 * only thing that ever enters memory.
 *
 * Returns null when this build has no encoder, or the encoder produced nothing —
 * the caller then uploads what the member picked, if it fits.
 */
export async function compressVideoFile(
  uri: string,
  targetBytes = TARGET_BYTES,
  progress?: CompressProgress,
): Promise<{ uri: string; mimeType: string; bytes: number | null } | null> {
  if (Platform.OS === 'web') return null;
  if (!nativeCompressorAvailable()) return null;
  const tell = report(progress);
  tell(0, 'Compressing your clip');
  // A NoSpaceError is the one failure that must reach the member: the phone
  // cannot hold the output, and pretending otherwise ends in "we couldn't read
  // that file" at the upload. Everything else falls back to the original.
  const out = await compressClipFile(uri, targetBytes, (fraction) =>
    tell(Math.min(0.99, fraction), 'Compressing'),
  );
  if (!out) return null;
  const bytes = out.bytes ?? (await fileSize(out.uri));
  tell(1, 'Uploading');
  return { uri: out.uri, mimeType: 'video/mp4', bytes };
}

/* ------------------------------------------------------------------- the web */

async function compressOnWeb(
  input: Blob,
  targetBytes: number,
  progress?: CompressProgress,
): Promise<CompressedVideo | null> {
  if (typeof document === 'undefined') return null;
  const mimeType = pickMime();
  if (!mimeType) return null;

  const url = URL.createObjectURL(input);
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  // Off-screen but attached: a detached video never decodes a frame.
  video.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0';

  try {
    document.body.appendChild(video);
    await once(video, 'loadedmetadata');
    const durationS = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    if (!durationS) return null;

    progress?.(0, 'Reading the clip');
    const kbps = videoBitrateKbps(durationS, targetBytes);
    const width = widthFor(kbps, video.videoWidth, video.videoHeight);
    const height = even((width * video.videoHeight) / Math.max(video.videoWidth, 1));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return null;

    /* The audio that goes with the picture.
       A canvas has no sound. The element can hand over its own audio track, and
       that track is then encoded by the recorder alongside the drawn frames —
       so a clip does not come out silent. A browser without captureStream still
       gets a picture, which is better than nothing but is reported as such by the
       caller's bitrate math, not invented here. */
    const stream = canvas.captureStream(FPS);
    const audio = audioTrackFor(video);
    if (audio) stream.addTrack(audio);

    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: kbps * 1000,
      audioBitsPerSecond: AUDIO_KBPS * 1000,
    });
    // What came out, not what we asked for: this is what labels the file.
    const outType = (recorder.mimeType || mimeType).split(';')[0];
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
    recorder.start(1000);

    /*
     * Progress is reported once per whole percent, not once per frame.
     *
     * The drawing loop runs sixty times a second and the screen showing the
     * progress is React: a callback per frame is a re-render per frame, which
     * makes the phone busy at exactly the moment it is already encoding. One
     * number per percent is all a person can read.
     */
    let raf = 0;
    let lastPercent = -1;
    const draw = () => {
      ctx.drawImage(video, 0, 0, width, height);
      const percent = Math.floor(Math.min(0.99, video.currentTime / durationS) * 100);
      if (percent !== lastPercent) {
        lastPercent = percent;
        progress?.(percent / 100, 'Compressing');
      }
      raf = requestAnimationFrame(draw);
    };

    await video.play();
    draw();
    await once(video, 'ended').catch(() => undefined);
    cancelAnimationFrame(raf);
    // One more frame after the end so the last moment is in the file.
    ctx.drawImage(video, 0, 0, width, height);
    recorder.stop();
    await done;
    for (const track of stream.getTracks()) track.stop();

    const blob = new Blob(chunks, { type: outType });
    // A transcode that grew the file is not a win: keep what the person had.
    if (!blob.size || blob.size >= input.size) return null;
    progress?.(1, 'Done');
    return {
      blob,
      mimeType: outType,
      width,
      height,
      durationMs: Math.round(durationS * 1000),
      bytes: blob.size,
    };
  } catch {
    return null;
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
    URL.revokeObjectURL(url);
  }
}

/**
 * The clip's sound, as a track we can hand to the recorder.
 *
 * A muted `<video>` is what browsers allow to start on its own, and a muted
 * element's own `captureStream()` is silent — so the sound is taken from the
 * media graph instead: the element's audio is routed into an AudioContext whose
 * only destination is the recorder. It is never connected to the speakers, which
 * is what keeps a compression job from playing the clip out loud while it works.
 */
function audioTrackFor(video: HTMLVideoElement): MediaStreamTrack | null {
  try {
    const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctx) {
      const ctx = new Ctx();
      const source = ctx.createMediaElementSource(video);
      const dest = ctx.createMediaStreamDestination();
      const gain = ctx.createGain();
      gain.gain.value = 1;
      source.connect(gain);
      gain.connect(dest);
      void ctx.resume?.();
      const track = dest.stream.getAudioTracks()[0] ?? null;
      if (track) return track;
    }
  } catch {
    /* fall through to the element's own track */
  }
  try {
    const captured = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.();
    return captured?.getAudioTracks?.()[0] ?? null;
  } catch {
    return null;
  }
}

function once(el: HTMLMediaElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = () => { cleanup(); resolve(); };
    const bad = () => { cleanup(); reject(new Error(`video ${event} failed`)); };
    const cleanup = () => {
      el.removeEventListener(event, ok);
      el.removeEventListener('error', bad);
    };
    el.addEventListener(event, ok, { once: true });
    el.addEventListener('error', bad, { once: true });
  });
}

/* ---------------------------------------------------------------- the phone */

/**
 * The same job on a phone, through the native encoder.
 *
 * `compressionMethod: 'auto'` with `maxSize` is the contract we want: give it a
 * ceiling in megabytes and it works out the bitrate itself. The number is
 * **megabytes**, not bytes — passing bytes here would ask the encoder for a
 * 64-million-megabyte file and it would simply encode at full quality.
 *
 * The clip is handed over as the path the picker gave us wherever possible. A
 * phone's gallery does not have to copy a 300 MB file into memory for this: the
 * encoder reads the file it already is. The Blob is only written out when the
 * caller had nothing but a Blob, and never above `INLINE_LIMIT_BYTES`, because a
 * base64 copy of a 300 MB clip is a way to lose the app to the watchdog.
 */
const INLINE_LIMIT_BYTES = 96 * 1024 * 1024;

async function compressOnDevice(
  input: Blob,
  targetBytes: number,
  { sourceUri, progress }: { sourceUri?: string; progress?: CompressProgress },
): Promise<CompressedVideo | null> {
  if (!nativeCompressorAvailable()) return null;
  let path = sourceUri && /^file:\/\//.test(sourceUri) ? sourceUri : '';
  let wroteTemp = false;
  if (!path) {
    if (input.size > INLINE_LIMIT_BYTES) return null;
    path = await blobToFileUri(input);
    wroteTemp = !!path;
  }
  if (!path) return null;
  progress?.(0.05, 'Compressing');
  try {
    const out = await compressClipFile(path, targetBytes, (fraction: number) =>
      progress?.(0.05 + Math.min(0.9, fraction) * 0.95, 'Compressing'),
    );
    if (!out) return null;
    try {
      const blob = await readBack(out.uri);
      if (!blob || !blob.size || blob.size >= input.size) return null;
      progress?.(1, 'Done');
      return { blob, mimeType: blob.type || 'video/mp4', width: 0, height: 0, durationMs: 0, bytes: blob.size };
    } finally {
      removeCompressedClip(out.uri);
    }
  } finally {
    if (wroteTemp) void deleteFile(path);
  }
}
/** The encoder's file, read back as a Blob so the upload path stays one shape. */
async function readBack(uri: string): Promise<Blob | null> {
  try {
    const res = await fetch(uri);
    if (res.ok) {
      const blob = await res.blob();
      if (blob.size) return blob;
    }
  } catch {
    /* a file:// URI is not always fetchable; fall through */
  }
  try {
    const FileSystem = fileSystem();
    const base64 = await FileSystem?.readAsStringAsync?.(uri, { encoding: 'base64' });
    if (!base64) return null;
    const binary = globalThis.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: 'video/mp4' });
  } catch {
    return null;
  }
}

type FileSystemLike = {
  cacheDirectory: string | null;
  writeAsStringAsync?: (uri: string, data: string, options: { encoding: string }) => Promise<void>;
  readAsStringAsync?: (uri: string, options: { encoding: string }) => Promise<string>;
  deleteAsync?: (uri: string, options?: { idempotent?: boolean }) => Promise<void>;
};

function fileSystem(): FileSystemLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    return require('expo-file-system') as FileSystemLike;
  } catch {
    return null;
  }
}

/**
 * A Blob on a phone has no path, and the native encoder wants one.
 *
 * expo-file-system writes the bytes to the cache directory and hands back a
 * `file://` URI, which is deleted once the encoder has finished with it — a
 * failed delete must never fail the upload.
 */
async function blobToFileUri(blob: Blob): Promise<string> {
  try {
    const FileSystem = fileSystem();
    if (!FileSystem?.cacheDirectory || !FileSystem.writeAsStringAsync) return '';
    const path = `${FileSystem.cacheDirectory}holupp-upload-${Date.now()}.mp4`;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    // In slices: `String.fromCharCode(...bytes)` on a big clip overflows the stack.
    const SLICE = 0x8000;
    for (let i = 0; i < bytes.length; i += SLICE) {
      binary += String.fromCharCode(...bytes.subarray(i, i + SLICE));
    }
    await FileSystem.writeAsStringAsync(path, globalThis.btoa(binary), { encoding: 'base64' });
    return path;
  } catch {
    return '';
  }
}

async function deleteFile(uri: string): Promise<void> {
  try {
    await fileSystem()?.deleteAsync?.(uri, { idempotent: true });
  } catch {
    /* a temp file left behind is not worth failing a post over */
  }
}

/** A short, human size for a toast: "72 MB". */
export function mb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}
