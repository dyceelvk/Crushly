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
