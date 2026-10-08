/**
 * Env cleanup for the Supabase connection — pure helpers, unit-tested.
 *
 * People paste whatever the Supabase dashboard shows: the Data API URL
 * (https://<ref>.supabase.co/rest/v1/), an Auth URL (…/auth/v1), a dashboard
 * link, a bare project ref, even a database connection string. supabase-js
 * wants the bare project origin; any extra path turns every auth call into
 * PostgREST's "Invalid path specified in request URL".
 */

/** Strip whitespace and the stray quotes values pick up from copy-paste. */
export function cleanEnvValue(raw: string | undefined | null): string {
  return String(raw ?? '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .trim();
}

/** Reduce whatever was pasted to the bare project origin, or '' if unusable. */
export function normalizeProjectUrl(raw: string | undefined | null): string {
  const v = cleanEnvValue(raw);
  if (!v) return '';

  // Database connection string: derive the project host from `db.<ref>.supabase.co`.
  const db = v.match(/^postgres(?:ql)?:\/\/db\.([a-z0-9-]+)\.supabase\.co/i);
  if (db) return `https://${db[1]}.supabase.co`;
  if (/^postgres(?:ql)?:\/\//i.test(v)) return '';

  // Bare project ref (no dots, slashes or scheme).
  if (/^[a-z0-9][a-z0-9-]{4,}$/.test(v)) return `https://${v}.supabase.co`;

  // Dashboard link → project host.
  const dash = v.match(/supabase\.com\/dashboard\/project\/([a-z0-9-]+)/i);
  if (dash) return `https://${dash[1]}.supabase.co`;

  // Scheme-less host (e.g. `abc.supabase.co/rest/v1`).
  const withScheme = /^https?:\/\//i.test(v) ? v : /\.supabase\.co\b/i.test(v) ? `https://${v}` : '';
  if (!withScheme) return '';

  try {
    // Origin only — drops /rest/v1, /auth/v1 and anything else, keeps ports
    // so local stacks like http://127.0.0.1:54321 survive.
    const origin = new URL(withScheme).origin;
    return origin === 'null' ? '' : origin;
  } catch {
    return '';
  }
}
