/**
 * The speed a hold-to-fast-forward gesture asks for.
 *
 * A clip is watched at the speed it was made. Holding the right of the picture
 * is the one gesture that means "show me the rest of this faster", and letting
 * go has to put it back — so the state is a pair of numbers, not a toggle, and
 * the original speed is remembered rather than assumed to be 1 (the creator may
 * have made a slow-motion clip, and returning it to 1× would silently undo that).
 */
export const HOLD_SPEED = 2;

export function speedWhile({ holding, base }: { holding: boolean; base: number | null | undefined }): number {
  const normal = Number(base);
  const settled = Number.isFinite(normal) && normal > 0 ? normal : 1;
  return holding ? Math.min(settled * HOLD_SPEED, 8) : settled;
}


/**
 * A tap is not a hold.
 *
 * The fast-forward strip answered `onPressIn`, so merely touching the right of
 * the picture started boosting — and it covered the mute button, so muting
 * fast-forwarded instead. A tap must never change speed: the boost only begins
 * once the finger has stayed down for this long, which is longer than any tap a
 * thumb makes by accident.
 */
export const HOLD_SPEED_DELAY_MS = 260;

/** Whether a touch that has been down for `heldMs` should be speeding the clip up. */
export function boostWhileHeld(heldMs: number): boolean {
  return heldMs >= HOLD_SPEED_DELAY_MS;
}
