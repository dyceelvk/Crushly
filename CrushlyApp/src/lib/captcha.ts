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

/** Where the native WebView loads the widget from. Must be a host in the key's allow list. */
export const CAPTCHA_PAGE_ORIGIN = 'https://holupp.net';

/** How long we wait for the check before letting the person try again. */
export const CAPTCHA_TIMEOUT_MS = 60_000;

/** The public site key, or '' when not configured. */
export function captchaSiteKey(): string {
  return cleanEnvValue(process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY ?? '');
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
  return 'The security check failed. Try again.';
}
