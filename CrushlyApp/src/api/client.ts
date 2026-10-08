import { Platform } from 'react-native';
import Constants from 'expo-constants';

/**
 * API base URL.
 *  - Web: same origin (the API serves the web build), so relative URLs work behind any proxy.
 *  - Native: EXPO_PUBLIC_API_URL, or the Metro dev host on port 3000 during development.
 */
function resolveBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/$/, '');
  if (Platform.OS === 'web') return '';
  const hostUri = Constants.expoConfig?.hostUri; // e.g. "192.168.1.20:8081"
  const host = hostUri ? hostUri.split(':')[0] : 'localhost';
  return `http://${host}:3000`;
}

export const API_URL = resolveBaseUrl();

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

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export const setAuthToken = (token: string | null) => {
  authToken = token;
};
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

/** Resolves server-relative media paths (/uploads/..., /seed/...) to absolute URLs on native. */
export function mediaUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (/^(https?:|file:|blob:|data:)/.test(path)) return path;
  return `${API_URL}${path}`;
}

type RequestOptions = { body?: unknown; form?: FormData; signal?: AbortSignal; timeoutMs?: number };

export async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form as unknown as BodyInit;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? (opts.form ? 60000 : 20000));
  opts.signal?.addEventListener('abort', () => controller.abort());

  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, { method, headers, body, signal: controller.signal });
  } catch (err) {
    const aborted = (err as Error)?.name === 'AbortError';
    throw new ApiError(
      0,
      aborted
        ? 'This is taking longer than usual. Check your connection and try again.'
        : 'You seem to be offline. Check your connection and try again.',
    );
  } finally {
    clearTimeout(timeout);
  }

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    if (res.status === 401 && authToken && !path.startsWith('/auth/')) onUnauthorized?.();
    throw new ApiError(res.status, json?.error?.message || 'Something went wrong. Please try again.', json?.error?.code);
  }
  return json as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>('GET', path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body }),
  delete: <T>(path: string, body?: unknown) => request<T>('DELETE', path, { body }),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, { form }),
};

/** Appends a local file (camera roll / recorder URI) to FormData on every platform. */
export async function appendFile(form: FormData, field: string, uri: string, name: string, type: string) {
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    form.append(field, blob, name);
  } else {
    form.append(field, { uri, name, type } as unknown as Blob);
  }
}
