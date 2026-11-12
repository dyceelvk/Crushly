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
