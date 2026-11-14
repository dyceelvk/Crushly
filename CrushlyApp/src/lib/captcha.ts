/**
 * The bot check, in one place.
 *
 * Supabase's captcha setting is only half of it: when it is on, GoTrue refuses
 * `signUp`, `signInWithPassword`, `resend` and `resetPasswordForEmail` unless
 * the request carries a Turnstile token. Turning the toggle on without this
 * file is what locked every member out on 2026-11-13 — the server asked for a
 * token nothing could produce.
 *
 * The site key here is public and is meant to be in the APK. The **secret** key
 * lives in Supabase and must never appear in this repository or a build — the
 * audit in `audit-apk-secrets.py` enforces that.
 *
 * With no site key configured the app behaves exactly as it did before: no
 * widget, no token, requests go out unchanged. That keeps development and the
 * web bundle working before the key is pasted in, and means a missing key fails
 * the captcha check in Supabase rather than breaking every screen locally.
 */
import { cleanEnvValue } from './env';

/** Cloudflare's script. `render=explicit` because we create the widget ourselves. */
export const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/**
 * Where the native WebView loads the widget from.
 *
 * `www.` and not the apex, and that matters: `https://holupp.net/...` answers
 * **308** to `https://www.holupp.net/...`, so the WebView was loading the apex,
 * being redirected, and — because the redirect target was not in the navigation
 * allow list — refusing the load. The sheet sat on a spinner with nothing in it
 * and no error, which is exactly how it was reported: "it doesn't show the
 * captcha, it keeps loading".
 *
 * The host here must also be in the Turnstile widget's allow list.
 */
export const CAPTCHA_PAGE_ORIGIN = 'https://www.holupp.net';

/** How long we wait for the check before letting the person try again. */
export const CAPTCHA_TIMEOUT_MS = 60_000;

/**
 * The site key is normalised before use, because it is a value a person edits
 * by hand in a web form and it is the one setting whose shape can be checked
 * without any network access.
 *
 * A Turnstile site key is exactly 24 characters: `0x4` and twenty-one more from
 * `[A-Za-z0-9_-]`. Anything appended to it — a stray paste, a quote, a newline —
 * makes Cloudflare answer "Invalid sitekey", which blocks every sign-in with no
 * useful explanation. Reducing the value to its real 24 characters costs
 * nothing and removes that failure completely.
 *
 * Correction on the record: an earlier commit claimed the shipped key carried 30
 * extra characters. It did not. That came from reading a Hermes string table —
 * the 24-character key is stored immediately before a 30-character font hash, so
 * a plain text search across the file shows the two as one run. The key in
 * 1.0.111–1.0.114 was correct, and the check that was failing was failing for
 * another reason.
 */
const SITE_KEY = /^0x4[A-Za-z0-9_-]{21}$/; // 3 + 21 = the 24 a Turnstile key always is

/** The 24-character key inside whatever was pasted, or '' if there isn't one. */
export function normalizeSiteKey(raw: string | undefined | null): string {
  const value = cleanEnvValue(raw).replace(/\s+/g, '');
  if (!value) return '';
  const start = value.indexOf('0x4');
  if (start < 0) return '';
  // Whatever follows the key is not part of it: a Turnstile key is a fixed
  // length, so the tail can be dropped without guessing.
  const candidate = value.slice(start, start + 24);
  return SITE_KEY.test(candidate) ? candidate : '';
}

/** The public site key, or '' when not configured or not a valid key. */
export function captchaSiteKey(): string {
  return normalizeSiteKey(process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY ?? '');
}

export function captchaEnabled(): boolean {
  return captchaSiteKey().length > 0;
}

/**
 * The page the native WebView loads.
 *
 * Turnstile validates the *page's* hostname against the key's allow list, and a
 * WebView has no hostname of its own — so the widget is served from holupp.net
 * rather than from `file://` or an inlined HTML string. Add `holupp.net` to the
 * Turnstile widget's allowed domains or this page renders nothing.
 */
export function captchaPageUrl(): string {
  const key = encodeURIComponent(captchaSiteKey());
  return `${CAPTCHA_PAGE_ORIGIN}/captcha.html?sitekey=${key}`;
}

/**
 * Which navigations the captcha WebView may follow.
 *
 * The widget page, its own `www.` host, and Cloudflare's challenge frames — and
 * nothing else. This is a security boundary (an allow list, not a deny list), so
 * it is a pure function with its own tests rather than a regex buried in a
 * component. Getting it wrong is invisible: a blocked navigation looks exactly
 * like a slow network.
 */
const CAPTCHA_HOSTS = ['holupp.net', 'www.holupp.net', 'challenges.cloudflare.com'];

export function captchaNavigationAllowed(rawUrl: string): boolean {
  let host: string;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:') return false;
    host = url.hostname.toLowerCase();
  } catch {
    return false;
  }
  return CAPTCHA_HOSTS.includes(host);
}

/**
 * How the widget is asked to render — and the reason web sign-in was broken even
 * with a correct key.
 *
 * `size: 'invisible'` was used for an invisible check. The current Turnstile
 * script rejects that value outright:
 *
 *   [Cloudflare Turnstile] Invalid value for parameter "size", expected
 *   "compact", "flexible", or "normal", got "invisible".
 *
 * `render()` therefore threw, no widget existed, `execute()` had nothing to run,
 * and the sign-in request reached Supabase with no token — so GoTrue answered
 * "captcha protection: request disallowed (no captcha_token found)" and the
 * member saw a security check that "didn't load". Only the browser was affected:
 * the phone opens its own captcha page instead.
 *
 * An invisible check is now one of the three valid sizes plus
 * `appearance: 'interaction-only'` (show the widget only if Cloudflare needs the
 * person) and `execution: 'execute'` (run when asked, not on page load).
 */
export const TURNSTILE_RENDER_OPTIONS = {
  size: 'flexible',
  appearance: 'interaction-only',
  execution: 'execute',
  retry: 'never',
} as const;

type Solver = () => Promise<string>;

let solver: Solver | null = null;

/**
 * Registered once, by whichever CaptchaHost is mounted for this platform:
 * `CaptchaHost.web.tsx` renders Cloudflare's widget into the page, and
 * `CaptchaHost.tsx` opens a WebView. Everything else calls `getCaptchaToken`.
 */
export function setCaptchaSolver(next: Solver | null): void {
  solver = next;
}

/**
 * A fresh token, or `undefined` when captcha is not configured.
 *
 * Tokens are single-use and expire after about five minutes, so this is called
 * at the moment of each auth request and never cached.
 */
export async function getCaptchaToken(): Promise<string | undefined> {
  if (!captchaEnabled()) return undefined;
  if (!solver) {
    // Configured in the build but no host mounted is a wiring bug, and saying so
    // is better than sending a request that GoTrue will reject with a less
    // useful message.
    throw new Error('The security check is not available yet. Reopen the app and try again.');
  }
  const token = await solver();
  const trimmed = String(token ?? '').trim();
  if (!trimmed) throw new Error('The security check did not complete. Try again.');
  return trimmed;
}

/** True when GoTrue rejected a request because of the captcha. */
export function isCaptchaError(message: string): boolean {
  return /captcha/i.test(message || '');
}

/**
 * What to say when the check fails.
 *
 * Never the provider's wording ("captcha protection: request disallowed (no
 * captcha_token found)") — that reads like a bug in the product. The person
 * needs to know it was a check, and that retrying is the way out.
 */
export function captchaFailureMessage(message: string): string {
  if (/no captcha_token found/i.test(message)) {
    return 'The security check didn’t load. Update the app, or turn the check off in Supabase while you test.';
  }
  /*
   * The check was configured wrong, not answered wrong.
   *
   * 110200 is Cloudflare's "invalid sitekey" / domain-not-allowed code, and it
   * is the one failure a person cannot retry their way out of. Saying "try
   * again" for it is what made a broken key look like a flaky phone.
   */
  if (/110200|invalid site ?key|invalid-input-response|not allowed/i.test(message)) {
    return 'The security check is set up wrong in this build, so it can’t pass. Signing in is blocked until it is fixed — please report it.';
  }
  return 'The security check failed. Try again.';
}
