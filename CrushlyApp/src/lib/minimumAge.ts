/**
 * Holup is currently 18+ until protected teen mode is ready. This value is duplicated by the database trigger
 * in the reviewed release migration; it is intentionally not an account type
 * or a client-only access check.
 */
export const MINIMUM_MEMBER_AGE = 18;

export const memberAgeLabel = () => `${MINIMUM_MEMBER_AGE}+`;

export const isMemberAgeEligible = (age: number | null | undefined): boolean =>
  typeof age === 'number' && Number.isFinite(age) && age >= MINIMUM_MEMBER_AGE;

export const clampMemberAge = (age: number): number =>
  Math.min(99, Math.max(MINIMUM_MEMBER_AGE, Math.round(age)));
