// Shared Didit v3 helpers for the edge functions: webhook signature
// verification (X-Signature-V2) and status mapping. Pure WebCrypto + JSON —
// runs in Deno (edge functions) and Node (unit tests) unchanged.

export const DIDIT_BASE = 'https://verification.didit.me';

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * Didit's canonical JSON: keys sorted recursively, whole-valued floats
 * shortened to ints, compact separators, raw UTF-8. JSON.stringify already
 * emits compact JSON with raw non-ASCII and turns 1.0 into 1, so recursively
 * sorting the keys is the whole job.
 */
export function canonicalize(payload: unknown): string {
  return JSON.stringify(sortKeysDeep(payload));
}

/** Constant-time hex comparison. */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}

/**
 * Verify a Didit webhook delivery: HMAC-SHA256 over the canonical JSON of the
 * payload, hex-compared to X-Signature-V2, with X-Timestamp freshness (±300s).
 * `rawBody` must be the exact bytes Didit sent — verify BEFORE parsing.
 */
export async function verifyDiditWebhook(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!signature || !timestamp || !secret) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > 300) return false;
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonicalize(payload)));
  const hex = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return safeEqual(hex, signature.toLowerCase());
}

/** Didit status ("Approved", "Declined", "In Review", ...) → Crushly request status. */
export function diditToAppStatus(diditStatus: string): 'approved' | 'rejected' | 'pending' {
  if (diditStatus === 'Approved') return 'approved';
  if (diditStatus === 'Declined') return 'rejected';
  return 'pending';
}

/** Crushly request status → profiles.verification value. */
export function appToProfileVerification(
  appStatus: 'approved' | 'rejected' | 'pending',
): 'verified' | 'rejected' | 'pending' {
  if (appStatus === 'approved') return 'verified';
  if (appStatus === 'rejected') return 'rejected';
  return 'pending';
}
