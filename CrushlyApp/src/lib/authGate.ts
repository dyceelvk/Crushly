/**
 * Which door the app should open, in one testable place.
 *
 * Extracted from the provider so the rule can be asserted rather than inspected.
 * The one that matters: a profile that is onboarded but has never given a
 * birthdate is sent back to onboarding. The age gate cannot judge an age nobody
 * stated, and inventing one on the member's behalf is not the app's business —
 * so it asks.
 */
export type AuthStatus = 'restoring' | 'signedOut' | 'onboarding' | 'resetting' | 'region' | 'ready';

export function authStatus(input: {
  restoring: boolean;
  signedIn: boolean;
  mustSetPassword: boolean;
  me: { onboarded: boolean; needsBirthdate: boolean } | null;
  /**
   * Whether the account has a country yet, and whether that answer is known at
   * all.
   *
   * `null` means the app has not been told — the region lookup failed, the
   * screen has not run, the network is down. Unknown must never mean "required
   * but impossible", because detection needs a working connection by definition.
   * So only an explicit `false` sends somebody to the Region screen; an unknown
   * answer lets them in, and the next successful detection fills it in.
   */
  regionLocated?: boolean | null;
}): AuthStatus {
  if (input.restoring) return 'restoring';
  if (!input.signedIn) return 'signedOut';
  if (input.mustSetPassword) return 'resetting';
  const me = input.me;
  if (me && (!me.onboarded || me.needsBirthdate)) return 'onboarding';
  if (me && input.regionLocated === false) return 'region';
  return 'ready';
}
