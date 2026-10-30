import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { cleanEnvValue, looksLikeSecretKey, normalizeProjectUrl } from '../lib/env';
import {
  MEDIA_BASE_URL,
  isMediaStoreUrl,
  mediaKind,
  mediaStorePath,
  mediaStoreUrl,
  moved,
  setMediaToken,
  setMediaTokenTransport,
} from '../lib/mediaHost';
import type { MediaKind } from '../lib/mediaHost';
import { storage } from '../lib/storage';
import { extensionFor, uploadContentType } from '../lib/upload';

// Re-exported from here because every caller has imported the extension helper
// from this module since long before it moved.
export { extensionFor, uploadContentType };

/**
 * Supabase client and shared transport helpers.
 *
 * The app talks to Supabase directly — Auth for identity, Postgres RPCs for
 * everything cross-member (see supabase/migrations/), Storage for media.
 * Configuration comes from Expo public env vars:
 *
 *   EXPO_PUBLIC_SUPABASE_URL       e.g. https://abcd.supabase.co
 *   EXPO_PUBLIC_SUPABASE_ANON_KEY  the public anon key
 */
// The dashboard hands out URLs with paths (/rest/v1/ …) — normalize to the
// bare project origin so supabase-js builds valid /auth/v1 endpoints.
const RAW_URL = cleanEnvValue(process.env.EXPO_PUBLIC_SUPABASE_URL);
const SUPABASE_URL = normalizeProjectUrl(RAW_URL);
const SUPABASE_ANON_KEY = cleanEnvValue(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

export const isConfigured = !!SUPABASE_URL && !!SUPABASE_ANON_KEY;

/** Why the build can't reach the backend, for the sign-in screens to explain. */
export const configProblem: 'none' | 'missing' | 'bad-url' | 'secret-key' = looksLikeSecretKey(SUPABASE_ANON_KEY)
  ? 'secret-key'
  : isConfigured
    ? 'none'
    : RAW_URL && !SUPABASE_URL
      ? 'bad-url'
      : 'missing';

/** Session storage: OS keychain/keystore on device, localStorage on the web. */
const authStorage = {
  getItem: (key: string) => storage.get(key),
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.remove(key),
};

export const supabase = createClient(SUPABASE_URL || 'http://localhost', SUPABASE_ANON_KEY || 'anon', {
  auth: {
    storage: authStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
    // Implicit flow: confirmation links carry the session in the URL fragment,
    // so they work even when opened from an email app's in-app browser (no PKCE
    // code-verifier to find in that browser's storage).
    flowType: 'implicit',
  },
});

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
  get isNetwork() {
    return this.status === 0;
  }
}

export function requireConfig(): void {
  if (configProblem === 'secret-key') {
    throw new ApiError(
      0,
      'This build has the SECRET Supabase key (sb_secret_/service_role) — it must never ship in the app. Use the Publishable key (or legacy anon public) instead.',
    );
  }
  if (configProblem === 'bad-url') {
    throw new ApiError(
      0,
      'The Supabase URL in this build is wrong. Use the bare Project URL — https://<ref>.supabase.co — not /rest/v1 or a connection string.',
    );
  }
  if (!isConfigured) {
    throw new ApiError(
      0,
      'Crushly isn’t configured yet. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.',
    );
  }
}

/**
 * RPCs raise `__CRUSHLY__<status>__<code>__<message>`, GoTrue returns its own
 * shapes, and everything else is an unexpected failure. All of it comes out as
 * an ApiError so screens keep the error handling they already have.
 */
export function toApiError(err: unknown): ApiError {
  const e = err as { message?: string; code?: string | number; status?: number };
  const message = String(e?.message ?? 'Something went wrong. Please try again.');
  const m = /^__CRUSHLY__(\d+?)__([a-z0-9_]*?)__([\s\S]*)$/.exec(message);
  if (m) return new ApiError(Number(m[1]), m[3] || message, m[2] || undefined);
  if (/invalid path specified/i.test(message)) {
    return new ApiError(
      0,
      'The Supabase URL in this build is wrong. Use the bare Project URL — https://<ref>.supabase.co — not /rest/v1 or a connection string.',
    );
  }
  if (/could not find the table|schema cache/i.test(message)) {
    return new ApiError(
      0,
      'The database schema isn’t set up on this Supabase project yet. Open its SQL editor, run supabase/setup.sql (see the README), then try again.',
    );
  }
  if (message === 'Failed to fetch' || /network|fetch failed|offline/i.test(message)) {
    return new ApiError(0, 'You seem to be offline. Check your connection and try again.');
  }
  const code = e?.code != null ? String(e.code) : undefined;
  const status = e?.status ?? (code === 'PGRST301' ? 401 : code === '42501' ? 403 : 500);
  if (status === 409 || /already (registered|exists)/i.test(message)) {
    return new ApiError(409, 'An account with this email already exists. Try signing in.', 'email_taken');
  }
  if (status === 400 && /invalid login credentials/i.test(message)) {
    return new ApiError(401, 'That email and password don’t match.');
  }
  return new ApiError(status, message, code);
}

/** Resolves stored media paths (`seed/x.jpg`, `photos/1/2.jpg`) to absolute URLs. */
export function mediaUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (/^(https?:|file:|blob:|data:)/.test(path)) return path;
  const clean = path.replace(/^\//, '');
  // The object store mints its own paths, so rows store the URL it handed back.
  const kind = mediaKind(clean);
  // Older Vibe rows contain Supabase storage paths; new Worker uploads store absolute URLs.
  if (kind && kind !== 'vibes' && moved(kind)) return mediaStoreUrl(clean);
  if (!SUPABASE_URL) return `/${clean}`;
  return supabase.storage.from('media').getPublicUrl(clean).data.publicUrl;
}

/**
 * The media Worker serves private files, so requests carry the member's access
 * token. Keep the cached copy in step with the session.
 */
// Browsers cannot attach an Authorization header to an <img>, so on the web the
// token rides in the query string instead. The Worker accepts either.
setMediaTokenTransport(Platform.OS === 'web');

void supabase.auth.getSession().then(({ data }) => setMediaToken(data.session?.access_token ?? null));
supabase.auth.onAuthStateChange((_event, session) => setMediaToken(session?.access_token ?? null));

/** Current access token, or a clear "sign in again" if the session is gone. */
async function mediaAccessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const access = data.session?.access_token;
  if (!access) throw new ApiError(401, 'Your session has expired — sign in again.');
  setMediaToken(access);
  return access;
}

async function mediaErrorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error || `We couldn’t save that file (${res.status}). Try again.`;
}

/**
 * Uploads to the object store. The server mints the path (see
 * `media_upload_ticket`), so a member can never write into somebody else's
 * folder — `path` only says which kind of media this is. Returns the absolute
 * URL, which is what the row stores.
 */
async function uploadToMediaStore(kind: MediaKind, blob: Blob, contentType: string): Promise<string> {
  const token = await mediaAccessToken();
  const res = await fetch(`${MEDIA_BASE_URL}/m`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType, 'X-Media-Kind': kind },
    body: blob,
  }).catch(() => null);
  if (!res) throw new ApiError(0, 'You seem to be offline. Check your connection and try again.');
  if (!res.ok) throw new ApiError(res.status, await mediaErrorMessage(res));
  const data = (await res.json().catch(() => null)) as { url?: string } | null;
  if (!data?.url) throw new ApiError(500, 'We couldn’t save that file. Try again.');
  return data.url;
}

async function deleteFromMediaStore(url: string): Promise<void> {
  const path = mediaStorePath(url);
  if (!path) return;
  try {
    const token = await mediaAccessToken();
    const res = await fetch(mediaStoreUrl(path), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) console.warn('media cleanup failed:', res.status);
  } catch (e) {
    console.warn('media cleanup failed:', (e as Error).message);
  }
}

/** Reads a local file (camera roll / recorder URI) into a Blob on any platform. */
export async function uriToBlob(uri: string): Promise<Blob> {
  let lastError: unknown = null;

  // fetch() works for blob:, data: and http: URIs on both web and native.
  try {
    const res = await fetch(uri, { cache: 'no-store' });
    if (!res.ok) throw new Error(`read failed (${res.status})`);
    return await res.blob();
  } catch (e) {
    lastError = e;
  }

  // XHR fallback — sometimes reads blob: URIs that fetch() refuses.
  try {
    const blob = await new Promise<Blob>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.onload = () => resolve(xhr.response as Blob);
      xhr.onerror = () => reject(lastError);
      xhr.responseType = 'blob';
      xhr.open('GET', uri, true);
      xhr.send();
    });
    return blob;
  } catch {
    console.warn('uriToBlob failed for:', uri, lastError);
    throw new ApiError(0, 'We couldn’t read that file. Try picking it again.');
  }
}

/**
 * Uploads local media to a storage bucket and returns its path.
 * User media must live in `<kind>/<profile id>/<file>` (see storage policies).
 */
export async function uploadMediaFile(
  bucket: 'media' | 'verification',
  path: string,
  uri: string,
  contentType: string,
): Promise<string> {
  requireConfig();
  const blob = await uriToBlob(uri);
  // One content type for both destinations, derived from the extension we are
  // actually going to store. A picker that reports `video/quicktime` alongside
  // a `.mp4` path used to be sent through verbatim, and the server rejected the
  // file as an unsupported type — which the app then reported as a row-policy
  // failure on the post.
  const ext = (path.split('.').pop() ?? '').toLowerCase();
  const type = uploadContentType(contentType, ext);
  const kind = bucket === 'media' ? mediaKind(path) : null;
  if (kind && moved(kind)) {
    try {
      return await uploadToMediaStore(kind, blob, type);
    } catch (e) {
      // There used to be a silent fallback here: write the same bytes into the
      // Supabase bucket and carry on. It never worked. That bucket is private
      // and holds none of the moved kinds, so `mediaUrl()` rewrote the stored
      // path back to the object store and the clip came out missing — a post
      // that looked successful and displayed nothing. Worse, the write it did
      // attempt failed on its own, and the message a member saw was "new row
      // violates row-level security policy", which sent everybody looking at
      // the post insert instead of at a 25 MB ceiling and a file-extension bug.
      //
      // So: no fallback. Say what happened, keep the draft in the composer, and
      // let them try again.
      console.warn('object store upload failed:', (e as Error).message);
      const message = (e as Error)?.message;
      throw new ApiError(
        (e as { status?: number })?.status ?? 0,
        message && !/^\s*$/.test(message) ? message : 'We couldn’t upload that file. Try again.',
      );
    }
  }
  // `upsert: false`, deliberately. Turned on, Storage answers an upload with an
  // UPDATE against storage.objects first, and that write is refused with "new
  // row violates row-level security policy" even for a file the member owns.
  // Every path here is minted from a timestamp, so there is nothing to replace.
  const { error } = await supabase.storage.from(bucket).upload(path, blob, { contentType: type, upsert: false });
  if (error) throw toApiError(error);
  return path;
}

export async function removeMediaFile(path?: string | null): Promise<void> {
  if (!path) return;
  if (isMediaStoreUrl(path)) {
    await deleteFromMediaStore(path);
    return;
  }
  if (/^(https?:|file:|blob:|data:)/.test(path)) return; // not ours to delete
  await supabase.storage.from('media').remove([path.replace(/^\//, '')]).then(({ error }) => {
    if (error) console.warn('media cleanup failed:', error.message);
  });
}

