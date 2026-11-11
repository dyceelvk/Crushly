/**
 * Where a paged feed is, and where one gesture takes it.
 *
 * The Flow is a stack of full-screen clips and the whole feel of it lives in two
 * numbers: which page is in front, and what the next gesture does. Both were
 * written inline, twice — once for the finger and once for the mouse wheel — and
 * they drifted: one clamped at the end, the other did not; one rounded, the other
 * floored. A fling that sails past three clips, or a last page that bounces back
 * to nothing, is exactly the kind of bug that comes from maths with two homes.
 *
 * So the maths has one home, and it is tested.
 */

/**
 * The page a scroll offset is nearest to.
 *
 * Rounded rather than floored: a clip that has moved 60% of the way up has
 * already been read, so the settle goes forward rather than back. `-0` is folded
 * into `0` so the first page cannot report itself as `-0` and fail an equality
 * check against `0`.
 */
export function pageAt(offset: number, height: number, count: number): number {
  if (!Number.isFinite(offset) || !Number.isFinite(height) || height <= 0) return 0;
  if (count <= 0) return 0;
  const page = Math.round(offset / height);
  return Math.min(Math.max(page, 0), count - 1) || 0;
}

/**
 * The page one gesture lands on.
 *
 * `direction` is +1 for forward, -1 for back, and anything else for neither. It
 * never leaves the list: the first page cannot be scrolled above, and the last
 * cannot be scrolled past — which is what stops a "next" at the end from bouncing
 * the reader halfway and back.
 */
export function stepIndex(index: number, direction: number, count: number): number {
  if (count <= 0) return 0;
  const from = Math.min(Math.max(Math.round(index), 0), count - 1);
  const delta = direction > 0 ? 1 : direction < 0 ? -1 : 0;
  return Math.min(Math.max(from + delta, 0), count - 1);
}

/**
 * True when a scroll has come to rest on something other than a whole page.
 *
 * A couple of pixels of slack, because browsers report sub-pixel offsets and
 * correcting a rounding error would fight the scroll for no reason at all.
 */
export function isOffPage(offset: number, height: number, slackPx = 2): boolean {
  if (!Number.isFinite(offset) || !Number.isFinite(height) || height <= 0) return false;
  return Math.abs(offset - Math.round(offset / height) * height) > slackPx;
}
