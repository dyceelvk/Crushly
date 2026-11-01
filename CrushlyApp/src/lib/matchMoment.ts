/**
 * When a match is worth interrupting somebody for.
 *
 * A Mutual Crush used to be celebrated exactly once, for the person who pressed
 * the button second. The other half — the one who already cared first — got a
 * toast that looked like every other toast, or a row in a list that could sit
 * there for days. Both people find out at the same moment in real life; the app
 * should not have an opinion about who hears it as an event.
 *
 * The rules live here rather than in the navigator because they are the kind of
 * thing that goes wrong quietly: an old match replayed on every launch, a match
 * shown twice, a day-old crush treated as news. All three are a timestamp and a
 * set lookup, which is exactly what a test can hold.
 */

/** How old a match may be and still be news. Two days. */
export const MATCH_WINDOW_MS = 48 * 60 * 60 * 1000;

/** The parts of a notification this decision needs — not the whole row. */
export type MatchCandidate = {
  id: number;
  kind: string;
  read?: boolean;
  createdAt?: number;
  actor: { id: number; name: string; photo?: string | null } | null;
};

/**
 * The live case: a match that arrived while the app was open.
 *
 * True exactly once per person per session — the caller marks them seen — and
 * never for a notification that is not a match.
 */
export function shouldOpenMoment(
  kind: string | null | undefined,
  actorId: number | null | undefined,
  seen: (id: number) => boolean,
): boolean {
  if (kind !== 'mutual') return false;
  if (!actorId) return false;
  return !seen(actorId);
}

/**
 * The launch case: a match that landed while the app was closed.
 *
 * Newest first, because the most recent person is the one you would want to see.
 * Unread only, so a match you have already been shown is not shown again — and
 * anybody already celebrated this session is skipped even if the row somehow
 * still says unread.
 *
 * `createdAt` missing means "we do not know how old this is"; that is treated as
 * news, because the alternative is a match nobody ever sees.
 */
export function pendingMatch<T extends MatchCandidate>(
  list: readonly T[] | null | undefined,
  now: number,
  seen: (id: number) => boolean,
  windowMs: number = MATCH_WINDOW_MS,
): T | null {
  if (!list || !list.length) return null;
  const candidates = list.filter((n) => {
    if (n.kind !== 'mutual' || !n.actor) return false;
    if (n.read) return false;
    if (seen(n.actor.id)) return false;
    if (typeof n.createdAt === 'number' && now - n.createdAt > windowMs) return false;
    return true;
  });
  if (!candidates.length) return null;
  return candidates.reduce((best, n) => ((n.createdAt ?? 0) > (best.createdAt ?? 0) ? n : best));
}
