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

/**
 * Why an auth email did not arrive, in words a member can act on.
 *
 * The project sends through its own SMTP, and Supabase caps auth mail at a
 * number of messages per hour for the *whole project* — every sign-up, resend
 * and password reset shares one allowance. When that runs out GoTrue answers
 * 429 and the screen used to say "couldn't send just now", which reads like a
 * typo rather than a queue. The one useful fact is that an earlier email still
 * holds a working code, so say that.
 */
export function emailSendMessage(raw: string): string {
  const text = String(raw ?? '');
  /**
   * Two different refusals arrive with the same error code, and telling them
   * apart matters: the per-address cooldown is over in under a minute, the
   * hourly cap is not. GoTrue names the seconds only in the first.
   */
  const wait = /you can only request this after (\d+) seconds?/i.exec(text);
  if (wait) {
    return `One email a minute per address — try again in ${wait[1]} seconds.`;
  }
  if (/too many|rate limit|over_email_send_rate_limit/i.test(text)) {
    return 'Crushly has sent as many emails as it can this hour. A code from an earlier email still works — or try again in a little while.';
  }
  if (/not authorized|invalid.*recipient|mailbox|address.*rejected/i.test(text)) {
    return 'That address could not receive mail. Check it for typos — or sign in if you already have a Space.';
  }
  if (/invalid.*(smtp|login|credentials)|auth/i.test(text)) {
    return 'Crushly couldn’t send mail just now. This is on us, not on you — try again shortly.';
  }
  return 'Couldn’t send that just now — wait a minute and try again.';
}
