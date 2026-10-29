import type { PostComment } from '../api/types';

/**
 * The arithmetic behind the comments sheet, kept apart from the drawing of it
 * so it can be tested without a screen.
 *
 * The sheet had a report against it: a comment field appearing where no comment
 * field belongs. Nothing here decides visibility — that is still the single
 * `visible` prop — but the numbers below are what keep the composer *inside*
 * the sheet and on screen, which is the half of that report that a screenshot
 * on a desk cannot check.
 */

export type Chest = { viewportHeight: number; keyboardHeight: number };

/** Share of the window the sheet stands at when nothing is in the way. */
export const SHEET_HEIGHT_RATIO = 0.78;
/** No sheet is taller than this, however tall the screen. */
export const SHEET_MAX_HEIGHT = 720;
/** Below this there is no point in the sheet at all — one comment and a composer. */
export const SHEET_MIN_HEIGHT = 180;

export type Placement = {
  /** Distance from the top of the window to the top of the sheet. */
  top: number;
  /** How tall the sheet is. */
  height: number;
};

/**
 * Where the sheet sits, given the window, the safe area and any keyboard.
 *
 * `viewportHeight` must already exclude the keyboard when one is open: on
 * Android with edge-to-edge the window no longer resizes for the keyboard, so
 * a sheet pinned to `bottom: 0` ends up underneath it and the composer goes
 * with it. Passing the remaining height and measuring from the top makes the
 * sheet sit *above* the keyboard instead of behind it.
 */
export function sheetPlacement({ viewportHeight, keyboardHeight }: Chest): Placement {
  const usable = Math.max(0, viewportHeight - Math.max(0, keyboardHeight));
  const wanted = Math.min(usable * SHEET_HEIGHT_RATIO, SHEET_MAX_HEIGHT);
  const height = Math.max(SHEET_MIN_HEIGHT, Math.min(wanted, usable));
  // Never let the sheet run off the bottom of what is actually visible.
  const bottomEdge = usable;
  return { top: Math.max(0, bottomEdge - height), height };
}

/**
 * How far the composer sits from the bottom of the sheet.
 *
 * It is pinned to the floor of the sheet and only moves up for the home
 * indicator, so it stays put while the list scrolls behind it.
 */
export function composerOffset(insetBottom: number | undefined): number {
  return Math.max(insetBottom ?? 0, 12);
}

/**
 * Whether pressing send would do anything.
 *
 * A draft of spaces is not a comment, and a second tap while the first is in
 * flight would post it twice.
 */
export function canSendComment(draft: string, sending: boolean): boolean {
  return draft.trim().length > 0 && !sending;
}

export type Row = { comment: PostComment; depth: 0 | 1 };

/**
 * Flattens the thread for the list: each comment, then its answers beneath it
 * when that comment is open.
 *
 * Answers are drawn one level deep at most, because the database refuses to
 * nest deeper — an answer to an answer is stored as an answer to its parent.
 * An answer whose parent is not in the payload is promoted to the top rather
 * than dropped: somebody said it, and a missing parent is no reason to lose it.
 */
export function commentRows(comments: PostComment[], open: number[] = []): Row[] {
  const tops = comments.filter((c) => c.parentId === null);
  const knownTops = new Set(tops.map((c) => c.id));

  const orphans = comments.filter((c) => c.parentId !== null && !knownTops.has(c.parentId));

  const rows: Row[] = [];
  for (const top of tops) {
    rows.push({ comment: top, depth: 0 });
    if (!open.includes(top.id)) continue;
    for (const answer of comments) {
      if (answer.parentId === top.id) rows.push({ comment: answer, depth: 1 });
    }
  }
  for (const orphan of orphans) rows.push({ comment: orphan, depth: 0 });
  return rows;
}

/**
 * How many comments the heading should claim.
 *
 * Answers are not comments; counting them would make the heading disagree with
 * the number on the post the sheet was opened from.
 */
export function threadTotal(comments: PostComment[]): number {
  return comments.filter((c) => c.parentId === null).length;
}

/**
 * Up to two people who answered each comment, for the stack beside
 * "View N replies" — real faces, not placeholders.
 */
export function answererStack(comments: PostComment[]): Map<number, PostComment[]> {
  const out = new Map<number, PostComment[]>();
  for (const c of comments) {
    if (c.parentId === null) continue;
    const list = out.get(c.parentId) ?? [];
    if (list.length < 2) list.push(c);
    out.set(c.parentId, list);
  }
  return out;
}
