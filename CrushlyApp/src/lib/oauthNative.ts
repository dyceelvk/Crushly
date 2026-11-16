/**
 * Google sign-in on the phone.
 *
 * The web path is a redirect: the page leaves for Google and comes back to
 * itself with the session in the URL. An app cannot do that — it has no page to
 * come back to — so the round trip is made explicit:
 *
 *   1. open the project's `/auth/v1/authorize` in an in-app browser (a Custom
 *      Tab on Android), telling it to return to `crushly://auth-callback`;
 *   2. Google talks to Supabase exactly as it does on the web — the Google
 *      console sees one redirect URI and never needs to know about the app;
 *   3. Supabase bounces back to `crushly://auth-callback`, the Custom Tab closes,
 *      and the app is handed the address it came back with.
 *
 * That address carries the session in its fragment (this project is on the
 * implicit flow, the same choice the web makes, so an in-app browser that shares
 * no storage with the app still works). Parsing it is the whole of this module —
 * kept pure and tested, because it is the one place where a malformed string
 * could be mistaken for a signed-in member.
 */

/**
 * Where Supabase sends the app back to.
 *
 * This must appear in the project's redirect allow list — it does
 * (`crushly://auth-callback`, plus `crushly://**`) — and it must match the
 * scheme declared in `app.json` (`"scheme": "crushly"`), or Android delivers the
 * link to nothing and the member sees a browser error page.
 */
export const NATIVE_REDIRECT = 'crushly://auth-callback';

/** The address to open in the in-app browser. */
export function nativeAuthorizeUrl(projectUrl: string, redirectTo: string = NATIVE_REDIRECT): string {
  const base = projectUrl.replace(/\/+$/, '');
  return `${base}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`;
}

/** True for an address this app's Google flow could have produced. */
export function isNativeReturn(url: string | undefined | null): boolean {
  if (!url) return false;
  const text = url.trim();
  return text.startsWith('crushly://auth-callback') || text.startsWith('crushly:///auth-callback');
}

export type NativeReturn =
  | { kind: 'session'; accessToken: string; refreshToken: string }
  | { kind: 'error'; message: string };

/**
 * Read what came back.
 *
 * `null` means the address is not ours at all, which is not an error — the
 * caller may be handed a plain `crushly://` link from somewhere else in the app
 * and must not treat it as a failed sign-in. An address that *is* ours but has
 * neither tokens nor an error is reported as an error rather than ignored: the
 * member tapped Continue with Google, and silence would look like a dead button.
 */
export function parseNativeReturn(url: string | undefined | null): NativeReturn | null {
  if (!isNativeReturn(url)) return null;
  const text = (url as string).trim();

  // Query and fragment are both read: Supabase puts a failure in the query and
  // the session in the fragment, and which lands where is not this app's choice.
  const params = new URLSearchParams();
  const q = text.indexOf('?');
  const h = text.indexOf('#');
  const read = (start: number) => {
    if (start < 0) return;
    let chunk = text.slice(start + 1);
    const nextHash = chunk.indexOf('#');
    if (nextHash >= 0) chunk = chunk.slice(0, nextHash);
    for (const [k, v] of new URLSearchParams(chunk)) params.set(k, v);
  };
  read(q);
  read(h);

  const error = (params.get('error') || params.get('error_code') || '').trim();
  if (error) {
    if (error === 'access_denied') return { kind: 'error', message: 'Google sign-in was cancelled.' };
    const said = (params.get('error_description') || '').replace(/[+_]/g, ' ').trim();
    return {
      kind: 'error',
      message: said ? `Google sign-in did not finish: ${said}` : 'Google sign-in did not finish. Please try again.',
    };
  }

  const accessToken = (params.get('access_token') || '').trim();
  const refreshToken = (params.get('refresh_token') || '').trim();
  // Both, or it is not a session. Accepting an access token on its own would
  // sign somebody in for an hour and drop them out with no way to renew.
  if (!accessToken || !refreshToken) {
    return { kind: 'error', message: 'Google did not send a session back. Please try again.' };
  }
  return { kind: 'session', accessToken, refreshToken };
}
