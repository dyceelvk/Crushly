/**
 * Turns transport, auth, database and runtime failures into clear, human error
 * copy. The raw error belongs in logs; a member should get a useful next step.
 */

const TECHNICAL =
  /(\bTypeError\b|\bRangeError\b|\bReferenceError\b|\bSyntaxError\b|^Error:|Failed to fetch|Network request failed|Load failed|NetworkError|timeout|timed out|ECONN|ENOTFOUND|ETIMEDOUT|socket hang up|JWT|apikey|API key|PGRST\d+|violates (check|foreign key|unique|not-null) constraint|duplicate key value|SQLSTATE|Postgres|PostgreSQL|JSON (Parse|parse)|Unexpected token|Cannot read propert|is not a function|is not defined|undefined is not an object|column .* does not exist|relation .* does not exist|permission denied for|row-level security|Query data cannot be undefined|Query key|data is undefined|No queryFn|AuthApiError|AuthRetryableFetchError|GoTrue|schema cache|invalid path specified|EXPO_PUBLIC_|sb_secret|service_role|Supabase (URL|key|project)|database schema|function public|\bRPC\b)/i;

export const OFFLINE_ERROR = 'You’re offline. Check your connection and try again.';
export const GENERIC_ERROR = 'We couldn’t complete that. Please try again.';

/** Replace terse, machine-like toast headings with a clear sentence. */
const ERROR_TITLES: Record<string, string> = {
  'Not updated': 'Couldn’t update your settings',
  'Something went wrong': 'We couldn’t finish that',
  'Call problem': 'Couldn’t connect the call',
  'Reaction failed': 'Couldn’t send your reaction',
  'Reaction not sent': 'Couldn’t send your reaction',
  'Not kept': 'Couldn’t save this for later',
  'Not deleted': 'Couldn’t delete that',
  'Not saved': 'Couldn’t save your changes',
  'Not sent': 'Couldn’t send that',
  'Not let go': 'Couldn’t remove this Connection',
  'Not renamed': 'Couldn’t rename this Circle',
  'Not added': 'Couldn’t add that',
  'Not removed': 'Couldn’t remove that',
  'Not recorded': 'Couldn’t record your video note',
  'That didn’t work': 'We couldn’t finish that',
  'Almost there': 'Couldn’t finish setting up your Space',
};

export function errorTitle(title: string): string {
  return ERROR_TITLES[title] ?? title;
}

/** Common backend/auth failures translated to specific, actionable language. */
const FRIENDLY_ERRORS: readonly [RegExp, string][] = [
  [/invalid login credentials|email and password.*don.t match/i, 'That email and password don’t match. Check them and try again.'],
  [/email not confirmed|not confirmed/i, 'Confirm your email first. Check your inbox for the code or link.'],
  [/expired.*(token|otp|code|link)|(token|otp|code|link).*expired/i, 'That code or link has expired. Request a new one.'],
  [/invalid.*(token|otp|code)|incorrect.*(token|otp|code)|otp.*invalid/i, 'That code or link didn’t work. Check it and try again.'],
  [/rate limit|too many|over_email_send_rate_limit/i, 'Too many attempts just now. Wait a little, then try again.'],
  [/error sending.*(email|mail)|failed to send.*(email|mail)|smtp/i, 'We couldn’t send the email just now. Please try again in a moment.'],
  [/already (registered|exists)|user already registered/i, 'An account with that email already exists. Sign in or reset your password.'],
  [/invalid email|email address.*invalid/i, 'That email address doesn’t look right. Check it and try again.'],
  [/password.*(too short|at least|minimum)|weak password/i, 'Choose a password with at least 8 characters.'],
  [/captcha/i, 'We couldn’t complete that check. Refresh the page and try again.'],
  [/session.*(missing|expired)|invalid.*refresh token/i, 'Your session has expired. Sign in again to continue.'],
];

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function rawMessage(error: unknown): string | null {
  return text(error) ?? (error && typeof error === 'object'
    ? text((error as { message?: unknown }).message)
    : null);
}

/**
 * The only line to show for a failure. Auth/backend errors we understand get a
 * helpful explanation; technical or unfamiliar output gets clean retry copy.
 */
export function errorLine(error: unknown, fallback?: string): string {
  const raw = rawMessage(error);
  if (raw && /Failed to fetch|Network request failed|Load failed|NetworkError|offline|ECONN|ENOTFOUND|timed out/i.test(raw)) {
    return OFFLINE_ERROR;
  }
  if (raw) {
    for (const [pattern, message] of FRIENDLY_ERRORS) {
      if (pattern.test(raw)) return message;
    }
    if (TECHNICAL.test(raw) || raw.length > 240) return fallback || GENERIC_ERROR;
    // A bare machine identifier is not a message written for a person.
    if (/^[a-z0-9_.:-]+$/i.test(raw)) return fallback || GENERIC_ERROR;
    return raw;
  }
  return fallback || GENERIC_ERROR;
}

/** True when the failure is the connection rather than the request. */
export function isOffline(error: unknown): boolean {
  const raw = rawMessage(error);
  return !!raw && /Failed to fetch|Network request failed|Load failed|NetworkError|offline|ECONN|ENOTFOUND|timed out/i.test(raw);
}
