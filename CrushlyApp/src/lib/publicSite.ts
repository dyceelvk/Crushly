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
 */
export const PUBLIC_SITE = 'https://holupp.net';

/** Hosts whose share links we mint or accept. */
export const PUBLIC_HOSTS = [
  'holupp.net',
  'www.holupp.net',
  'holupapp.vercel.app',
  'mecrushly.vercel.app',
];

/** Is this a holUpp web host, old or new? */
export function isPublicHost(hostname: string): boolean {
  return PUBLIC_HOSTS.includes(String(hostname ?? '').toLowerCase());
}
