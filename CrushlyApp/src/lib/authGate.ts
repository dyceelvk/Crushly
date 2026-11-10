/**
 * Which door the app should open, in one testable place.
 *
 * Extracted from the provider so the rule can be asserted rather than inspected.
 * The one that matters: a profile that is onboarded but has never given a
 * birthdate is sent back to onboarding. The age gate cannot judge an age nobody
 * stated, and inventing one on the member's behalf is not the app's business —
 * so it asks.
 */
export type AuthStatus = 'restoring' | 'signedOut' | 'onboarding' | 'resetting' | 'ready';

export function authStatus(input: {
  restoring: boolean;
  signedIn: boolean;
  mustSetPassword: boolean;
  me: { onboarded: boolean; needsBirthdate: boolean } | null;
}): AuthStatus {
  if (input.restoring) return 'restoring';
  if (!input.signedIn) return 'signedOut';
  if (input.mustSetPassword) return 'resetting';
  const me = input.me;
  if (me && (!me.onboarded || me.needsBirthdate)) return 'onboarding';
  return 'ready';
}
