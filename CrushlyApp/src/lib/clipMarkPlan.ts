/**
 * When to mark a clip on the phone, and what to do when it fails.
 *
 * The rule this file exists to keep: **the Save row must exist the moment the
 * post does.** Everything else follows from that.
 *
 * Background, because it is the bug being fixed. The mark used to be produced
 * only by `scripts/mark_pending_clips.py` on a five-minute cron, and the Save row
 * is drawn only when `post.downloadUrl` is present — so the row appeared
 * minutes-to-hours after posting, or never when the runner was blocked. Members
 * reported it three times as "the download button never happens".
 *
 * So marking moves into the upload, and this module decides it. The decision is
 * pure and takes a plain object, because the interesting cases (no encoder, a
 * clip already marked, a transcode that failed halfway) must be testable without
 * a phone, a clip or a network.
 */

/** What the native side reports. */
export type MarkResult = { path: string; bytes: number; ms: number };

export type MarkPlan =
  /** Mark now, on this device, before upload. */
  | { action: 'mark'; endCard: boolean }
  /** Upload the file as it is. The scheduled job will still produce a marked copy. */
  | { action: 'skip'; reason: 'web' | 'no-encoder' | 'already-marked' | 'too-big' };

export type MarkInputs = {
  /** 'ios' | 'android' | 'web' — marking is Android-only today. */
  platform: string;
  /** Does the native module say this device can encode H.264? */
  encoderAvailable: boolean;
  /** Bytes of the file about to be uploaded. */
  bytes: number | null;
  /** true when the picked file already carries a mark (a re-post of a saved clip). */
  alreadyMarked?: boolean;
};

/**
 * A ceiling for marking specifically, not for posting.
 *
 * Marking runs Transformer twice over the file (decode + encode) on the same
 * phone that just compressed it. Past this the phone gets hot and the member
 * waits, and the scheduled backfill is the better trade — it costs them nothing
 * but a later button, which is what they had before anyway.
 */
export const MARK_LIMIT_BYTES = 120 * 1024 * 1024;

export function planMark(input: MarkInputs): MarkPlan {
  if (input.platform !== 'android') return { action: 'skip', reason: 'web' };
  if (!input.encoderAvailable) return { action: 'skip', reason: 'no-encoder' };
  if (input.alreadyMarked) return { action: 'skip', reason: 'already-marked' };
  if (input.bytes !== null && input.bytes > MARK_LIMIT_BYTES) return { action: 'skip', reason: 'too-big' };
  // The end card is appended as part of the same composition, so a marked clip
  // and its end card can never be produced separately and drift apart.
  return { action: 'mark', endCard: true };
}

/**
 * What the poster is told while this is happening.
 *
 * Marking is not instant, and a progress line that says nothing is how "the app
 * is frozen" gets reported. These strings are the whole of the copy.
 */
export function markProgressLabel(fraction: number | null): string {
  if (fraction !== null && fraction >= 0.99) return 'Finishing your clip…';
  return 'Adding your name to the clip…';
}

/**
 * The upload is never blocked by marking.
 *
 * If the transcode fails — no encoder, out of space, a format Media3 cannot
 * handle — the clip goes up unmarked and the scheduled job marks it later. What
 * must NOT happen is the post failing because a decoration did. The Save row then
 * appears on a later fetch, which is exactly the old behaviour and still better
 * than losing the post.
 */
export function markFailureIsFatal(): false {
  return false;
}

/**
 * Where the marked copy goes in the bucket, derived from where the original
 * went — never chosen freely.
 *
 * The server refuses to store a key the client names (`register_own_post_download`
 * derives it itself, from `posts.media_url`). This function has to agree with
 * `marked_download_key()` in `20261113120000_own_post_download.sql` and with
 * `marked_key()` in `scripts/mark_pending_clips.py`. Three copies of one rule is
 * one too many, but the alternative is trusting a client-supplied path, and that
 * is how a Save button ends up pointing at somebody else's file.
 *
 * `posts/41/1740000000.mp4` -> `posts/41/1740000000-marked.mp4`
 */
export function markedClipKey(originalKey: string): string {
  const key = originalKey.trim().replace(/^\/+/, '');
  if (!key) return '';
  // The dot is required: without it `posts/41/no-extension` reads as having an
  // extension (`…sion`) and comes back unchanged, which would have uploaded the
  // marked copy over the original.
  return /\.[A-Za-z0-9]+$/.test(key) ? key.replace(/\.[A-Za-z0-9]+$/, '-marked.mp4') : `${key}-marked.mp4`;
}
