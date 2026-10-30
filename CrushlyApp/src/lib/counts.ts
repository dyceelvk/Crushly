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
