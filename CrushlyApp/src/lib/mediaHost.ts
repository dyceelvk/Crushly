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

/** Base URL of the media Worker, '' when the object store isn't configured. */
export const MEDIA_BASE_URL = cleanEnvValue(process.env.EXPO_PUBLIC_MEDIA_BASE_URL).replace(/\/+$/, '');

export const mediaStoreEnabled = MEDIA_BASE_URL.length > 0;

export type MediaKind = 'photos' | 'moments' | 'messages';

/** The kind of a stored path (`moments/12/a.jpg` → `moments`). */
export function mediaKind(path: string): MediaKind | null {
  const kind = path.replace(/^\/+/, '').split('/')[0];
  return kind === 'photos' || kind === 'moments' || kind === 'messages' ? kind : null;
}

/** Stored path → the URL the app renders. */
export function mediaStoreUrl(path: string): string {
  return `${MEDIA_BASE_URL}/m/${path
    .replace(/^\/+/, '')
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
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

/** A player/image source: plain URL normally, authenticated for our own files. */
export function mediaSource(url?: string | null): string | { uri: string; headers?: Record<string, string> } {
  const headers = mediaAuthHeaders(url);
  return headers ? { uri: url as string, headers } : (url as string);
}
