/**
 * Which relationship contract the deployed backend speaks.
 *
 * The app was written for the v2 relationship routines (`holup_follow*`,
 * `holup_homie*`). A production database that has not been given them answers
 * PostgREST's "function not found" instead, and every Add Up / Homie control
 * on the Space page turns into a Retry chip. That is what shipped, so the
 * client now asks once per session and adapts instead of assuming.
 *
 * The distinction this module draws matters: PostgREST reports a **missing
 * routine** as `PGRST202` (or SQLSTATE `42883`), while a routine that exists
 * but refuses the request can also answer 404 ("Space not available", "This
 * list is private"). Treating the second as the first would quietly downgrade
 * a live v2 backend to the legacy contract, so only a real "not found" counts.
 */

type Errorish = { code?: string; message?: string; status?: number };

const NOT_FOUND = /could not find the function|function .* does not exist|42883/i;

/**
 * True only when the backend genuinely lacks the routine. Everything else —
 * a refused request, a network fault, a timeout — means "the function is
 * there but the call failed", which must never be read as legacy.
 */
export function isMissingFunctionError(e: Errorish | null | undefined): boolean {
  if (!e) return false;
  if (e.code === 'PGRST202') return true;
  return NOT_FOUND.test(e.message ?? '');
}

/**
 * The contract to use, given the probe's outcome. A missing routine means the
 * deployed database predates v2; any other error leaves v2 in place, because
 * a refusal is not evidence the routine is absent.
 */
export function backendFromProbe(outcome: { missing: boolean }): 'v2' | 'legacy' {
  return outcome.missing ? 'legacy' : 'v2';
}

/** Supabase resolves HTTP errors in `error`; it does not throw by default.
 * A business 404 from the known invalid probe target proves v2 exists. Other
 * failures must propagate, not poison the per-session backend cache.
 */
export function relationshipBackendFromResponse(error: Errorish | null): 'v2' | 'legacy' {
  if (!error) return 'v2';
  if (isMissingFunctionError(error)) return 'legacy';
  if (/^__CRUSHLY__404__/.test(error.message ?? '')) return 'v2';
  throw error;
}
