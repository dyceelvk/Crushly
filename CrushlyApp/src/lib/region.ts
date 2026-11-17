/**
 * Passive region identification.
 *
 * The app never works out where it is. It asks the server to look at the
 * connection the request arrived on, and the server decides. There is no
 * parameter here for a country, a city or an IP — that is deliberate: an app
 * that can *tell* the server where it is can also lie to it.
 *
 * Three rules govern when this runs:
 *
 *  1. At most once per `MIN_GAP_MS` per process, so opening the app four times
 *     in a minute is one request, not four.
 *  2. Never on a timer. There is no polling here, and no background task: this
 *     is a call made when the member is already using the app, not surveillance.
 *  3. Failure is silent. A member with a flaky connection is not shown an error
 *     because a region lookup failed; region is derived, not required.
 *
 * Deliberately free of react-native imports so it can be tested with plain Node.
 */

export type RegionEvent =
  | 'REGISTER'
  | 'LOGIN'
  | 'SESSION_REFRESH'
  | 'SENSITIVE_ACTION'
  | 'WITHDRAWAL'
  | 'SECURITY_EVENT';

export type RegionResult = {
  identified: boolean;
  reason?: string;
  country?: string | null;
  countryName?: string | null;
  continent?: string | null;
  subregion?: string | null;
  region?: string | null;
  city?: string | null;
  region_status?: 'IDENTIFIED' | 'UNVERIFIED' | 'MISMATCH' | 'SUSPECTED_VPN' | 'NEEDS_REVIEW';
  selected_country_code?: string | null;
  detected_country_code?: string | null;
  effective_country_code?: string | null;
};

/** How often one running app instance may ask. */
export const MIN_GAP_MS = 30 * 60 * 1000;

/**
 * Pure so it can be tested: should a report be sent now, given when the last
 * one was sent? `undefined` means "never", which always reports.
 */
export function shouldReport(now: number, lastSentAt: number | undefined, gap = MIN_GAP_MS): boolean {
  if (lastSentAt === undefined) return true;
  if (!Number.isFinite(lastSentAt) || !Number.isFinite(now)) return true;
  // Clock going backwards (a member changing their device clock) must not lock
  // reporting out forever.
  if (now < lastSentAt) return true;
  return now - lastSentAt >= gap;
}

/**
 * What the app is running on, as a coarse category — never a device identifier.
 * The caller passes `Platform.OS`; this module deliberately does not import
 * react-native, so it can be tested with plain Node.
 */
export function deviceCategory(os: string | undefined): 'android' | 'ios' | 'web' | 'desktop' | 'unknown' {
  switch (os) {
    case 'android':
      return 'android';
    case 'ios':
      return 'ios';
    case 'web':
      return 'web';
    case 'macos':
    case 'windows':
      return 'desktop';
    default:
      return 'unknown';
  }
}

let lastSentAt: number | undefined;
let inFlight: Promise<RegionResult | null> | null = null;

/**
 * Ask the server where this connection is, and record it. Returns `null` when
 * the call was skipped or failed — callers are not required to do anything with
 * the result, and none of the app's screens block on it.
 */
export async function reportRegion(
  event: RegionEvent = 'SESSION_REFRESH',
  options: {
    force?: boolean;
    now?: number;
    /** `Platform.OS` from the caller. */
    platform?: string;
    invoke?: (body: Record<string, unknown>) => Promise<unknown>;
  } = {},
): Promise<RegionResult | null> {
  const now = options.now ?? Date.now();
  if (!options.force && !shouldReport(now, lastSentAt)) return null;
  if (inFlight) return inFlight;

  const invoke = options.invoke ?? defaultInvoke;
  lastSentAt = now;

  inFlight = (async () => {
    try {
      const data = (await invoke({
        event,
        deviceCategory: deviceCategory(options.platform),
        requestId: `${now}-${Math.random().toString(36).slice(2, 10)}`,
      })) as RegionResult | undefined;
      return data ?? null;
    } catch {
      // Silent by design. A region miss is not a member-facing error.
      return null;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Resets the throttle. Test-only; nothing in the app calls this. */
export function __resetRegionThrottle() {
  lastSentAt = undefined;
  inFlight = null;
}

async function defaultInvoke(body: Record<string, unknown>): Promise<unknown> {
  // Imported lazily so this module stays testable without a Supabase client.
  const { supabase } = await import('../api/client');
  const { data, error } = await supabase.functions.invoke('region-intel', { body });
  if (error) throw error;
  return data;
}
