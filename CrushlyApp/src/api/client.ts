import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { cleanEnvValue, normalizeProjectUrl } from '../lib/env';
import { storage } from '../lib/storage';

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
export const configProblem: 'none' | 'missing' | 'bad-url' = isConfigured
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
  if (!SUPABASE_URL) return `/${clean}`;
  return supabase.storage.from('media').getPublicUrl(clean).data.publicUrl;
}

/** Reads a local file (camera roll / recorder URI) into a Blob on any platform. */
export async function uriToBlob(uri: string): Promise<Blob> {
  try {
    const res = await fetch(uri);
    if (!res.ok) throw new Error('read failed');
    return await res.blob();
  } catch {
    return new Promise<Blob>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.onload = () => resolve(xhr.response as Blob);
      xhr.onerror = () => reject(new ApiError(0, 'We couldn’t read that file. Try picking it again.'));
      xhr.responseType = 'blob';
      xhr.open('GET', uri, true);
      xhr.send();
    });
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
  const { error } = await supabase.storage.from(bucket).upload(path, blob, { contentType, upsert: true });
  if (error) throw toApiError(error);
  return path;
}

export async function removeMediaFile(path?: string | null): Promise<void> {
  if (!path || /^(https?:|file:|blob:|data:)/.test(path)) return;
  await supabase.storage.from('media').remove([path.replace(/^\//, '')]).then(({ error }) => {
    if (error) console.warn('media cleanup failed:', error.message);
  });
}

/** File extension for a mime type, with sensible fallbacks. */
export function extensionFor(mimeType: string | undefined, fallback = 'jpg'): string {
  const type = (mimeType ?? '').toLowerCase();
  if (type.includes('jpeg')) return 'jpg';
  if (type.includes('webm')) return 'webm';
  if (type.includes('mpeg') || type.includes('mp3')) return 'mp3';
  if (type.includes('mp4') || type.includes('m4a') || type.includes('aac')) return 'm4a';
  if (type.includes('png')) return 'png';
  const fromType = type.split('/')[1];
  return fromType && fromType.length <= 5 ? fromType : fallback;
}
