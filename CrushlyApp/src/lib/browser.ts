/** React Native defines window = global, but it is not a browser. */
export type BrowserLocation = { pathname?: string; search?: string; hash?: string; origin?: string };
export function browserLocation(platform: string, candidate: { location?: BrowserLocation } | undefined): BrowserLocation | undefined {
  return platform === 'web' ? candidate?.location : undefined;
}

/**
 * The address an OAuth round trip should come back to.
 *
 * Coming back to the origin is not enough on a host whose root is a different
 * page from the app: `https://www.holupp.net` is the marketing site and the app
 * is `/app`, so a member who signed in with Google was returned to the website
 * with a session in the fragment that nothing was listening for. The page they
 * left from is the page they should land on again.
 */
export function returnUrl(loc: BrowserLocation | undefined): string | undefined {
  if (!loc?.origin) return undefined;
  const path = (loc.pathname || '/').replace(/\/+$/, '');
  return `${loc.origin}${path}`;
}
