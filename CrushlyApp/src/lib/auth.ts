/**
 * Pure helpers for the auth screens (signup, sign-in, password reset) and the
 * verification pose draw — extracted so the rules are unit-tested, not buried
 * in components.
 */

/** Keep only digits and cap at the 6-digit code length, for OTP inputs. */
export function sanitizeOtp(raw: string): string {
  return String(raw ?? '')
    .replace(/[^0-9]/g, '')
    .slice(0, 6);
}

/** True once the entry is a complete 6-digit code. */
export function isCompleteOtp(code: string): boolean {
  return sanitizeOtp(code).length === 6;
}

export type PasswordStrength = 'Too short' | 'Good' | 'Strong';

/** Coarse strength label for the password hint under sign-up/reset inputs. */
export function passwordStrength(password: string): PasswordStrength | null {
  if (!password) return null;
  if (password.length < 8) return 'Too short';
  if (/[0-9]/.test(password) && /[A-Za-z]/.test(password) && password.length >= 10) return 'Strong';
  return 'Good';
}

/**
 * Draw two distinct poses from the illustrated library for one verification
 * attempt. `rand` is injectable so tests are deterministic.
 */
export function drawPosePair<T>(library: readonly T[], rand: () => number = Math.random): [T, T] {
  if (library.length < 2) throw new Error('drawPosePair needs at least 2 poses');
  const a = Math.floor(rand() * library.length) % library.length;
  let b = Math.floor(rand() * library.length) % library.length;
  while (b === a) b = (b + 1 + Math.floor(rand() * (library.length - 1))) % library.length;
  return [library[a], library[b]];
}

/**
 * What a *successful* `signUp` call actually means.
 *
 * GoTrue does not error when the address already belongs to a confirmed
 * account. It answers 200, with a user that has **zero identities**, and sends
 * nothing at all — deliberately, so the endpoint cannot be used to discover who
 * has an account. Reading that as "we sent you an email" is a promise the member
 * cannot act on, and it is indistinguishable from a mail server that is broken.
 * The two cases have to be told apart in the UI.
 */
export type SignUpOutcome = 'signed-in' | 'already-registered' | 'confirm-email';

export function signUpOutcome(result: {
  session?: unknown;
  user?: { identities?: readonly unknown[] | null } | null;
}): SignUpOutcome {
  if (result.session) return 'signed-in';
  if (result.user && (result.user.identities?.length ?? 0) === 0) return 'already-registered';
  return 'confirm-email';
}
