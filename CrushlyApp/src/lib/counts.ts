/**
 * Numbers people read at a glance.
 *
 * A count under ten thousand is small enough to be honest about — "2037" tells
 * you more than "2K" does, and it is short enough to sit in a rail. Past that
 * the exact number stops being information and starts being noise, so it is
 * shortened with one decimal and the trailing ".0" dropped.
 */
export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';

  const whole = Math.floor(n);
  if (whole < 10_000) return String(whole);

  if (whole < 1_000_000) {
    return `${(whole / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  }

  return `${(whole / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

/**
 * The number a screen reader hears, spelled out.
 *
 * `formatCount` is for the eye: "12.4K" is easier to take in at a glance than
 * "12417", and past ten thousand the exact digit barely means anything. A
 * screen reader has the opposite problem — it reads "12.4K" as a word, and the
 * person listening gets a rounded figure with no way to ask for the real one.
 *
 * So the visible rail keeps the short form and the accessibility label carries
 * the exact count, spelled out with its noun. This is what Facebook does on its
 * own rails: the pixels read "10K", the label reads "Like, 10000 reactions".
 *
 * Returns an empty string for a count that is not worth announcing at all, so
 * callers can always append it without special-casing zero.
 */
export function spokenCount(n: number, singular: string, plural?: string): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  const whole = Math.floor(n);
  return `${whole} ${whole === 1 ? singular : (plural ?? `${singular}s`)}`;
}
