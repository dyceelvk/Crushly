/**
 * What a member is allowed to read when something goes wrong.
 *
 * Every screen that can fail had the same line in it — `message={(err as
 * Error).message}` — which meant the app's error states were printing whatever
 * the layer below produced: `TypeError: Failed to fetch` on a bad connection,
 * `JWT expired`, `new row violates check constraint "profiles_bio_check"`, a
 * Postgres code, or a stack. None of that is the member's business and none of it
 * tells them what to do.
 *
 * A message gets through only if it was written for a person. `ApiError`s raised
 * by `api/service.ts` are exactly that ("You can show up to 6 photos."), so they
 * pass. Anything that smells like a runtime error, a network failure or a
 * database complaint is replaced with the fallback sentence.
 */

/** Shapes that can only come from a runtime, a network layer or the database. */
const TECHNICAL =
  /(\bTypeError\b|\bRangeError\b|\bReferenceError\b|\bSyntaxError\b|^Error:|Failed to fetch|Network request failed|Load failed|NetworkError|timeout|timed out|ECONN|ENOTFOUND|ETIMEDOUT|socket hang up|JWT|apikey|API key|PGRST\d+|violates (check|foreign key|unique|not-null) constraint|duplicate key value|JSON (Parse|parse)|Unexpected token|Cannot read propert|is not a function|is not defined|undefined is not an object|column .* does not exist|relation .* does not exist|permission denied for|row-level security)/i;

export const GENERIC_ERROR = 'Something interrupted the connection. Give it another try.';

/** Trimmed non-empty string, or null. */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * The one line to show. Never a stack, never a status code, never `undefined`.
 */
export function errorLine(error: unknown, fallback = GENERIC_ERROR): string {
  const raw =
    text(error) ??
    (error && typeof error === 'object' ? text((error as { message?: unknown }).message) : null);
  if (!raw) return fallback;
  if (TECHNICAL.test(raw)) return fallback;
  // A sentence fragment that happens to be a bare identifier is not a message.
  if (raw.length > 240) return fallback;
  return raw;
}

/** True when the failure is the connection rather than the request. */
export function isOffline(error: unknown): boolean {
  const raw =
    text(error) ??
    (error && typeof error === 'object' ? text((error as { message?: unknown }).message) : null);
  return !!raw && /Failed to fetch|Network request failed|Load failed|NetworkError|offline|ECONN|ENOTFOUND|timed out/i.test(raw);
}
