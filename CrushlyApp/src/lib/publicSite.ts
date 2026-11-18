/**
 * Where holUpp lives, in one place.
 *
 * The app used to hard-code `holupapp.vercel.app` in every share link, every
 * deep link and every card, which meant buying a domain changed nothing: the
 * links people sent each other still carried the Vercel hostname. The canonical
 * site is now `https://holupp.net`, and it is named once, here.
 *
 * The old hosts are still accepted when a link is *read*, and that is not
 * politeness — every post and Space shared before today carries one, and a link
 * that stops working is worse than a link with an old hostname in it. New links
 * are always minted on the new domain.
 *
 * `holupapp.vercel.app` has since been retired outright: it belongs to no project,
 * so it answers Vercel's "deployment not found" page, and nothing may be minted on
 * it again. `mecrushly.vercel.app` is the project's own address and still answers;
 * it is accepted so a Vercel URL resolves, never advertised.
 */
export const PUBLIC_SITE = 'https://holupp.net';

/** Hosts whose share links we mint or accept. */
export const PUBLIC_HOSTS = [
  'holupp.net',
  'www.holupp.net',
  'mecrushly.vercel.app',
];

/**
 * Hosts that must never appear in a link again.
 *
 * A named list rather than a comment so the test suite can assert the retired
 * hostname stays retired, and so anything that still meets one can be told where
 * to go instead of being handed a page that does not exist.
 */
export const RETIRED_HOSTS = ['holupapp.vercel.app'];

export function isRetiredHost(hostname: string): boolean {
  return RETIRED_HOSTS.includes(String(hostname ?? '').toLowerCase());
}

/** Is this a holUpp web host, old or new? */
export function isPublicHost(hostname: string): boolean {
  return PUBLIC_HOSTS.includes(String(hostname ?? '').toLowerCase());
}
