/**
 * How long a Moment clip is, and where its trim window starts.
 *
 * This is three rules that were each broken in a way nobody could see in the app
 * until a clip came out a blink long:
 *
 * 1. **A Moment clip is 25 seconds.** Not a minute — a Moment is a glimpse, and
 *    a minute of glimpse is a post.
 * 2. **The picker's duration is a hint, not a fact.** `expo-image-picker` is
 *    documented in milliseconds, but the number that actually arrives depends on
 *    the platform and the file, and on the web it can be missing entirely. A
 *    value that is really seconds, read as milliseconds, is a 25-second clip
 *    filed as 0.025 seconds — which is how a trim screen ends up offering a
 *    one-second window and producing a one-second Moment. So the number is only
 *    trusted once it has been sanity-checked, and the decoder's own duration
 *    always wins when it is available.
 * 3. **A window is never zero.** When the length is still unknown the answer is
 *    "not yet" — the screen waits — not a window of `Math.max(1, ...)` over a
 *    file it has not measured.
 *
 * Everything here is pure, so all three rules are covered by tests rather than by
 * hoping a phone behaves.
 */

/** The longest Moment clip, in seconds. */
export const MOMENT_CLIP_SECONDS = 25;

/**
 * Above this, a duration reported in "seconds" is really milliseconds.
 *
 * A Moment clip can only be 25 seconds, and a picker never invents a two-minute
 * value out of nothing, so anything past two minutes has to be milliseconds. The
 * other direction is not ambiguous: a millisecond reading of a short clip is
 * thousands, and a seconds reading of the same clip is a small number.
 */
export const MILLISECOND_FLOOR = 120;

/**
 * A duration from a picker, in seconds — or `null` when it is not usable.
 *
 * `null` is a real answer and the caller has to handle it: it means "ask the
 * decoder", not "assume zero".
 */
export function pickerSeconds(duration: number | null | undefined): number | null {
  const value = Number(duration);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value > MILLISECOND_FLOOR ? value / 1000 : value;
}

export type ClipWindow = { start: number; end: number };

/**
 * The window to open on: the whole clip, cut at the cap if the file is longer.
 *
 * A 40-second clip opens on its first 25 seconds with the rest still reachable,
 * which is kinder than a window that starts somewhere arbitrary.
 */
export function openingWindow(total: number, cap: number = MOMENT_CLIP_SECONDS): ClipWindow {
  const length = Number.isFinite(total) && total > 0 ? total : 0;
  if (!length) return { start: 0, end: 0 };
  return { start: 0, end: Math.min(length, cap) };
}

/**
 * Force a window inside the file and inside the cap.
 *
 * Kept the same shape as the slider's own contract — `low`, `high`, a step — so
 * the screen never has to re-derive a rule the tests already hold.
 */
export function clampWindow(
  start: number,
  end: number,
  total: number,
  cap: number = MOMENT_CLIP_SECONDS,
): ClipWindow {
  const length = Math.max(0, Number.isFinite(total) ? total : 0);
  if (!length) return { start: 0, end: 0 };
  const step = 0.1;
  const snap = (value: number) => Math.round(value / step) * step;

  const low = Math.min(Math.max(0, snap(start)), Math.max(0, length - step));
  const highest = Math.min(length, low + cap);
  const high = Math.min(Math.max(low + step, snap(end)), highest);
  return { start: Number(low.toFixed(1)), end: Number(high.toFixed(1)) };
}

/** Seconds as `m:ss`, for the trim screen's labels. */
export function clipTimeLabel(seconds: number): string {
  const whole = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
