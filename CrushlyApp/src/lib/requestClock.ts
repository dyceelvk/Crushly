/**
 * Every request has a deadline.
 *
 * A social app is judged on the network people actually have. A half-open socket
 * on mobile data does not fail — it waits. Supabase JS has no timeout of its own,
 * so a request that is never answered leaves the screen on its skeleton forever,
 * and React Query's retry never fires because nothing rejected. The audit found
 * this on 5 November: `grep AbortController src/api` returned nothing.
 *
 * This wraps `fetch` once, at the client, so every RPC, auth call and storage
 * request inherits the deadline instead of each service function remembering it.
 *
 * Two budgets, because they are not the same request:
 *
 *   · a question (`/rest/v1/rpc/…`, auth, reads) — 15 seconds, then "that took
 *     too long" is the honest answer;
 *   · a body (`/storage/v1/object/…`) — five minutes, because a clip is tens of
 *     megabytes and cutting it off at fifteen seconds would make posting video
 *     fail on exactly the connections that need patience.
 *
 * A caller that brings its own signal keeps it: the deadline then means "the
 * earliest of ours and yours", and an abort we caused is distinguishable from an
 * abort somebody else caused, so the message is never a lie.
 */

export const QUESTION_TIMEOUT_MS = 15_000;
export const UPLOAD_TIMEOUT_MS = 300_000;

/** How long this particular request is allowed to take. */
export function budgetFor(url: string): number {
  return /\/storage\/v1\/object\//.test(url) ? UPLOAD_TIMEOUT_MS : QUESTION_TIMEOUT_MS;
}

/** A timeout is not an offline device; say which one happened. */
export function timeoutMessage(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return seconds >= 60
    ? `That took longer than ${Math.round(seconds / 60)} minute${seconds >= 120 ? 's' : ''}. Check your connection and try again.`
    : `That took longer than ${seconds} seconds. Check your connection and try again.`;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * `fetch`, with a deadline. Returns a function with the same shape, so it can be
 * handed to `createClient({ global: { fetch } })` and never thought about again.
 */
export function fetchWithDeadline(
  base: FetchLike,
  /* Injected so the tests can use milliseconds instead of waiting out a real
     fifteen-second deadline; production passes nothing. */
  opts: { budget?: (url: string) => number; now?: () => number } = {},
): FetchLike {
  const budgetForUrl = opts.budget ?? budgetFor;
  const now = opts.now ?? (() => Date.now());
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const budget = budgetForUrl(url);

    const controller = new AbortController();
    const theirs = init?.signal ?? null;
    const abortFromTheirs = () => controller.abort();

    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      controller.abort();
    }, budget);

    if (theirs) {
      if (theirs.aborted) controller.abort();
      else theirs.addEventListener('abort', abortFromTheirs, { once: true });
    }

    const started = now();
    try {
      return await base(input, { ...init, signal: controller.signal });
    } catch (e) {
      // Our deadline, not the caller's abort and not the device going offline —
      // those already have their own copy in lib/errors.ts.
      if (expired) {
        const error = new Error(timeoutMessage(budget));
        (error as Error & { code?: string }).code = 'REQUEST_TIMEOUT';
        (error as Error & { elapsed?: number }).elapsed = now() - started;
        throw error;
      }
      throw e;
    } finally {
      clearTimeout(timer);
      if (theirs) theirs.removeEventListener('abort', abortFromTheirs);
    }
  };
}
