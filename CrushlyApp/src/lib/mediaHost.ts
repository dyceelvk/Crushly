/**
 * Where member photos and video notes live.
 *
 * They used to sit in a PUBLIC Supabase Storage bucket — anyone holding a link
 * could fetch any chat photo, forever, even after the message was gone. Media
 * now goes to a private bucket that only the Cloudflare Worker can open
 * (`cloudflare/media-worker`), and the Worker asks the database who may see
 * what, so blocks, connections and Moment expiry keep their usual meaning.
 *
 * The switch is one build-time value:
 *
 *   EXPO_PUBLIC_MEDIA_BASE_URL=https://crushly-media.<account>.workers.dev
 *
 * Empty means "keep using Supabase Storage", so the app runs unchanged and
 * unsetting it rolls back to files that are already there. Rows store whatever
 * the upload returned, so old paths and new URLs both resolve — nothing has to
 * be rewritten when this flips.
 */
import { cleanEnvValue } from './env';

/**
 * The deployed Worker. Not a secret — it is the public address files are served
 * from — so it works with no configuration at all. Set the env var to point
 * somewhere else, or to '' to switch the object store off.
 */
const DEFAULT_MEDIA_BASE_URL = 'https://crushly-media.dyceelvk.workers.dev';

/** Base URL of the media Worker, '' when the object store is switched off. */
export const MEDIA_BASE_URL = (() => {
  const configured = process.env.EXPO_PUBLIC_MEDIA_BASE_URL;
  if (configured === undefined) return DEFAULT_MEDIA_BASE_URL;
  return cleanEnvValue(configured).replace(/\/+$/, '');
})();

export const mediaStoreEnabled = MEDIA_BASE_URL.length > 0;

/**
 * Which kinds of media have moved over, comma-separated. Everything a member
 * uploads — profile photos, Moments, and chat media including photos and video
 * notes — lives on the object store; Supabase keeps the rows, not the files.
 * Listing fewer kinds here moves one back without touching this file.
 */
export const MEDIA_KINDS: MediaKind[] = (() => {
  // Same shape as the base URL: unset means "use the default", set to ''
  // means "none of them", so a kind can be pulled back without editing code.
  const configured = process.env.EXPO_PUBLIC_MEDIA_KINDS;
  const raw = configured === undefined ? 'photos,moments,messages,posts' : cleanEnvValue(configured);
  return raw.split(',').map((k) => k.trim()).filter((k): k is MediaKind =>
    k === 'photos' || k === 'moments' || k === 'messages' || k === 'posts',
  );
})();

/** True when `kind` has moved to the object store. */
export function moved(kind: MediaKind): boolean {
  return mediaStoreEnabled && MEDIA_KINDS.includes(kind);
}

/**
 * How the access token travels. Native apps send it as a header; browsers
 * cannot put headers on an <img>, so the web sends it in the query string
 * instead (the Worker accepts both, and never caches those responses).
 */
let tokenInQuery = false;

export function setMediaTokenTransport(web: boolean): void {
  tokenInQuery = web;
}

export type MediaKind = 'photos' | 'moments' | 'messages' | 'posts';

/** The kind of a stored path (`moments/12/a.jpg` → `moments`). */
export function mediaKind(path: string): MediaKind | null {
  const kind = path.replace(/^\/+/, '').split('/')[0];
  return kind === 'photos' || kind === 'moments' || kind === 'messages' || kind === 'posts' ? kind : null;
}

/** Stored path → the URL the app renders, with the token when browsers need it. */
export function mediaStoreUrl(path: string, withToken = tokenInQuery): string {
  const url = `${MEDIA_BASE_URL}/m/${path
    .replace(/^\/+/, '')
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
  return withToken && token ? `${url}?token=${encodeURIComponent(token)}` : url;
}

/** Absolute media-Worker URL → its stored path, or null if it isn't ours. */
export function mediaStorePath(url: string): string | null {
  if (!mediaStoreEnabled || !url.startsWith(`${MEDIA_BASE_URL}/m/`)) return null;
  const path = url.slice(`${MEDIA_BASE_URL}/m/`.length).split('?')[0];
  return path ? decodeURIComponent(path) : null;
}

export function isMediaStoreUrl(url?: string | null): boolean {
  return !!url && mediaStorePath(url) !== null;
}

/* --------------------------------------------------------------- session token */

/**
 * The access token cached for media requests. Media files are private, so
 * images, video notes and voice notes are fetched with it attached — the Worker
 * checks it against Supabase before returning a single byte.
 */
let token: string | null = null;

export function setMediaToken(next: string | null): void {
  token = next;
}

/** Authorization headers for a media-Worker URL; undefined for anything else. */
export function mediaAuthHeaders(url?: string | null): Record<string, string> | undefined {
  if (!token || !isMediaStoreUrl(url)) return undefined;
  return { Authorization: `Bearer ${token}` };
}

/**
 * A ready-to-use image/player source. On native this is the URL plus an
 * Authorization header; on the web the token is already in the URL, because a
 * browser will not send headers for an <img>.
 */
export function mediaSource(url?: string | null): string | { uri: string; headers?: Record<string, string> } {
  if (!isMediaStoreUrl(url)) return (url ?? '') as string;
  if (tokenInQuery) {
    const base = (url as string).split('?')[0];
    return token ? `${base}?token=${encodeURIComponent(token)}` : base;
  }
  const headers = mediaAuthHeaders(url);
  return headers ? { uri: url as string, headers } : (url as string);
}
