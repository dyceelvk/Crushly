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
 * pass. Anything that smells like a runtime error, a network failure, a
 * database complaint or a query library talking about itself ("Query data cannot
 * be undefined. Query key: [\"conversation\",1]") is replaced with the fallback
 * sentence — the last of those was found by rendering an error state with nothing
 * but the raw error to show.
 */

/** Shapes that can only come from a runtime, a network layer or the database. */
const TECHNICAL =
  /(\bTypeError\b|\bRangeError\b|\bReferenceError\b|\bSyntaxError\b|^Error:|Failed to fetch|Network request failed|Load failed|NetworkError|timeout|timed out|ECONN|ENOTFOUND|ETIMEDOUT|socket hang up|JWT|apikey|API key|PGRST\d+|violates (check|foreign key|unique|not-null) constraint|duplicate key value|JSON (Parse|parse)|Unexpected token|Cannot read propert|is not a function|is not defined|undefined is not an object|column .* does not exist|relation .* does not exist|permission denied for|row-level security|Query data cannot be undefined|Query key|data is undefined|No queryFn)/i;

/**
 * The house voice, for when something goes wrong.
 *
 * Short, warm, and never a diagnosis: the member is not being asked to read a
 * stack trace, they are being asked to try once more. The list rather than one
 * sentence so the same app does not say the same thing every single time — the
 * second failure in a row is the one that reads as a machine talking.
 */
export const HOUSE_LINES = [
  'That didn’t make it through. One more go?',
  'The signal dropped this one. Try again?',
  'Nothing got through that time. Give it another tap.',
  'That one slipped. Try once more.',
];

/** A stable pick: the same failure reads the same way twice in a row. */
export function houseLine(seed = 0): string {
  return HOUSE_LINES[Math.abs(Math.floor(seed)) % HOUSE_LINES.length];
}

/** For a failure that is plainly the connection rather than the request. */
export const OFFLINE_ERROR = 'You’re off the grid for a second. It’ll go through when you’re back.';

export const GENERIC_ERROR = HOUSE_LINES[0];

/** True when a line is one of ours — used by the tests, and by nothing else. */
export function isHouseLine(line: string): boolean {
  return HOUSE_LINES.includes(line) || line === OFFLINE_ERROR;
}

/** Trimmed non-empty string, or null. */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * The one line to show. Never a stack, never a status code, never `undefined`.
 */
/** A stable little hash, so one failure always reads one way. */
function seedOf(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) & 0xffff;
  return h;
}

export function errorLine(error: unknown, fallback?: string): string {
  if (isOffline(error)) return OFFLINE_ERROR;
  const house = () => {
    const raw =
      text(error) ?? (error && typeof error === 'object' ? text((error as { message?: unknown }).message) : null);
    return fallback ?? houseLine(seedOf(raw ?? ''));
  };
  const raw =
    text(error) ??
    (error && typeof error === 'object' ? text((error as { message?: unknown }).message) : null);
  if (!raw) return house();
  if (TECHNICAL.test(raw)) return house();
  // A sentence fragment that happens to be a bare identifier is not a message.
  if (raw.length > 240) return house();
  return raw;
}

/** True when the failure is the connection rather than the request. */
export function isOffline(error: unknown): boolean {
  const raw =
    text(error) ??
    (error && typeof error === 'object' ? text((error as { message?: unknown }).message) : null);
  return !!raw && /Failed to fetch|Network request failed|Load failed|NetworkError|offline|ECONN|ENOTFOUND|timed out/i.test(raw);
}
