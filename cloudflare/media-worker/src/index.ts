/**
 * Crushly media Worker — the only thing that can read or write the media bucket.
 *
 * Photos used to sit in a public Supabase bucket: anyone holding a link could
 * fetch any chat photo, forever, even after the message itself was gone. Now
 * the bucket is private and every request comes through here.
 *
 * This Worker deliberately decides nothing about who may see what. It takes the
 * member's Supabase access token, and asks the database — `can_view_media`,
 * `can_manage_media`, `media_upload_ticket` — so blocks, connections, profile
 * visibility and Moment expiry keep exactly the meaning they already have.
 * Storage is Backblaze B2 over its native API (no S3 signing needed).
 *
 * Secrets live in Worker secrets, set by .github/workflows/deploy-worker.yml.
 * Nothing here is ever committed.
 */

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  B2_KEY_ID: string;
  B2_APPLICATION_KEY: string;
  B2_BUCKET: string;
}

const AUTHORIZE_URL = 'https://api.backblazeb2.com/b2api/v2/b2_authorize_account';
const AUTH_TTL_MS = 23 * 60 * 60 * 1000; // B2 tokens last 24h; refresh early
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // matches media_upload_ticket's ceiling

/* ------------------------------------------------------------------- helpers */

const cors = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin ?? '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Media-Kind',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
});

const json = (body: unknown, status: number, origin: string | null, extra: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(origin), ...extra },
  });

const fail = (status: number, message: string, origin: string | null) =>
  json({ error: message }, status, origin);

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** `/m/photos/12/a.jpg?token=…` → `photos/12/a.jpg`, and the query token if any. */
function splitPath(url: URL): { path: string; queryToken: string | null } {
  const path = decodeURIComponent(url.pathname.replace(/^\/m\/?/, '').replace(/^\/+/, ''));
  return { path, queryToken: url.searchParams.get('token') };
}

function bearerToken(request: Request, queryToken: string | null): string | null {
  const header = request.headers.get('Authorization');
  if (header?.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  // Players that cannot set headers (some audio/video components) may pass it
  // as ?token=. Never cached, never logged.
  return queryToken;
}

/* ------------------------------------------------------------ authentication */

const members = new Map<string, { id: string; exp: number }>();

/** Resolves an access token to a member id, or null when it isn't signed in. */
async function memberId(env: Env, token: string): Promise<string | null> {
  const hit = members.get(token);
  if (hit && hit.exp > Date.now()) return hit.id;

  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY },
  }).catch(() => null);
  if (!res?.ok) return null;

  const user = (await res.json().catch(() => null)) as { id?: string } | null;
  if (!user?.id) return null;

  members.set(token, { id: user.id, exp: Date.now() + 5 * 60 * 1000 });
  if (members.size > 1000) members.clear(); // isolate-local, so keep it small
  return user.id;
}

type RpcResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

/** Calls the database with the member's own token, so RLS and rules apply. */
async function rpc<T>(env: Env, token: string, fn: string, body: unknown): Promise<RpcResult<T>> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: env.SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }).catch(() => null);

  if (!res) return { ok: false, status: 502, message: 'Could not reach the database.' };
  const text = await res.text();
  if (!res.ok) {
    let message = 'Not allowed.';
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? message;
    } catch {
      /* keep the default */
    }
    return { ok: false, status: res.status, message };
  }
  return { ok: true, data: (text ? JSON.parse(text) : null) as T };
}

/* ------------------------------------------------------------------ Backblaze */

type Lifecycle = { hideAfterDays: number | null; deleteAfterDays: number | null };

type B2Auth = {
  token: string;
  apiUrl: string;
  downloadUrl: string;
  bucketId: string;
  bucketType: string;
  lifecycle: Lifecycle | null;
  exp: number;
};

let b2: Promise<B2Auth> | null = null;

/** Which setup value is wrong. Only the category is ever reported. */
class B2Error extends Error {
  constructor(readonly kind: 'auth' | 'bucket') {
    super(kind);
  }
}

async function authorize(env: Env): Promise<B2Auth> {
  const res = await fetch(AUTHORIZE_URL, {
    headers: { Authorization: `Basic ${btoa(`${env.B2_KEY_ID}:${env.B2_APPLICATION_KEY}`)}` },
  }).catch(() => null);
  if (!res?.ok) throw new B2Error('auth'); // keyID or applicationKey refused
  const data = (await res.json()) as {
    authorizationToken: string;
    apiUrl: string;
    downloadUrl: string;
  };

  const buckets = await fetch(`${data.apiUrl}/b2api/v2/b2_list_buckets`, {
    method: 'POST',
    headers: { Authorization: data.authorizationToken },
    body: JSON.stringify({ bucketName: env.B2_BUCKET }),
  });
  if (!buckets.ok) throw new B2Error('bucket');
  const list = (await buckets.json()) as {
    buckets: {
      bucketId: string;
      bucketName: string;
      bucketType?: string;
      lifecycleRules?: { fileNamePrefix?: string; daysFromUploadingToHiding?: number | null; daysFromHidingToDeleting?: number | null }[];
    }[];
  };
  const bucket = list.buckets.find((b) => b.bucketName === env.B2_BUCKET);
  // The key is fine but cannot see that bucket: wrong name, or the key was
  // scoped to a different one.
  if (!bucket) throw new B2Error('bucket');

  // The rule that makes "Moments disappear after 24 hours" true at the storage
  // layer, whether or not our own jobs run. Reported by /health.
  const rule = (bucket.lifecycleRules ?? []).find((r) => (r.fileNamePrefix ?? '') === 'moments/');
  const lifecycle: Lifecycle | null = rule
    ? {
        hideAfterDays: rule.daysFromUploadingToHiding ?? null,
        deleteAfterDays: rule.daysFromHidingToDeleting ?? null,
      }
    : null;

  return {
    token: data.authorizationToken,
    apiUrl: data.apiUrl,
    downloadUrl: data.downloadUrl,
    bucketId: bucket.bucketId,
    bucketType: bucket.bucketType ?? 'unknown',
    lifecycle,
    exp: Date.now() + AUTH_TTL_MS,
  };
}

/** Cached per isolate; re-authorises automatically when the token goes stale. */
function b2Auth(env: Env): Promise<B2Auth> {
  if (!b2) b2 = authorize(env);
  return b2
    .then(async (auth) => {
      if (auth.exp > Date.now()) return auth;
      b2 = authorize(env);
      return b2;
    })
    .catch((e: unknown) => {
      // Never cache a failure: once the key or bucket name is corrected it has
      // to take effect on the next request, not on the next deploy.
      b2 = null;
      throw e;
    });
}

async function b2Upload(env: Env, path: string, contentType: string, bytes: ArrayBuffer) {
  const auth = await b2Auth(env);
  const slot = await fetch(`${auth.apiUrl}/b2api/v2/b2_get_upload_url`, {
    method: 'POST',
    headers: { Authorization: auth.token },
    body: JSON.stringify({ bucketId: auth.bucketId }),
  });
  if (!slot.ok) throw new Error(`B2 upload url failed (${slot.status})`);
  const { uploadUrl, authorizationToken } = (await slot.json()) as {
    uploadUrl: string;
    authorizationToken: string;
  };

  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: authorizationToken,
      'X-Bz-File-Name': encodeURIComponent(path),
      'Content-Type': contentType,
      'X-Bz-Content-Sha1': hex(await crypto.subtle.digest('SHA-1', bytes)),
    },
    body: bytes,
  });
  if (!res.ok) throw new Error(`B2 upload failed (${res.status})`);
}

/** Private bucket, so the download carries the account token. */
function b2Download(env: Env, auth: B2Auth, path: string): Promise<Response> {
  return fetch(`${auth.downloadUrl}/file/${encodeURIComponent(env.B2_BUCKET)}/${path
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`, { headers: { Authorization: auth.token } });
}

async function b2Delete(env: Env, path: string): Promise<boolean> {
  const auth = await b2Auth(env);
  const versions = await fetch(`${auth.apiUrl}/b2api/v2/b2_list_file_versions`, {
    method: 'POST',
    headers: { Authorization: auth.token },
    body: JSON.stringify({ bucketId: auth.bucketId, startFileName: path, prefix: path, maxFileCount: 1 }),
  });
  if (!versions.ok) return false;
  const { files } = (await versions.json()) as { files?: { fileName: string; fileId: string }[] };
  const file = files?.find((f) => f.fileName === path);
  if (!file) return true; // already gone

  const res = await fetch(`${auth.apiUrl}/b2api/v2/b2_delete_file_version`, {
    method: 'POST',
    headers: { Authorization: auth.token },
    body: JSON.stringify({ fileName: file.fileName, fileId: file.fileId }),
  });
  return res.ok;
}

/* -------------------------------------------------------------------- routes */

/**
 * Setup check. Reports whether each piece is wired up correctly — Supabase
 * reachable, the B2 key accepted, the bucket private, and the Moments lifecycle
 * rule in place — without ever exposing a credential. A `false` anywhere means
 * the matching setup step needs another look.
 */
async function health(env: Env, origin: string | null): Promise<Response> {
  const supabase = await fetch(`${env.SUPABASE_URL}/auth/v1/settings`, {
    headers: { apikey: env.SUPABASE_ANON_KEY },
  })
    .then((r) => r.ok)
    .catch(() => false);

  let storage: {
    b2: boolean;
    bucketPrivate: boolean;
    momentsLifecycle: Lifecycle | null;
    problem?: 'auth' | 'bucket';
  } = { b2: false, bucketPrivate: false, momentsLifecycle: null };
  try {
    const auth = await b2Auth(env);
    storage = {
      b2: true,
      bucketPrivate: auth.bucketType === 'allPrivate',
      momentsLifecycle: auth.lifecycle,
    };
  } catch (e) {
    if (e instanceof B2Error) storage.problem = e.kind;
  }

  const ok =
    supabase &&
    storage.b2 &&
    storage.bucketPrivate &&
    (storage.momentsLifecycle?.deleteAfterDays ?? 0) >= 1;
  return json({ ok, supabase, ...storage }, ok ? 200 : 503, origin);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const head = cors(origin);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: head });
    if (url.pathname === '/health') return health(env, origin);

    const { path, queryToken } = splitPath(url);
    const token = bearerToken(request, queryToken);
    if (!token) return fail(401, 'Sign in to load this.', origin);
    if (!(await memberId(env, token))) return fail(401, 'That session has expired — sign in again.', origin);

    /* ------------------------------------------------------------- upload */
    if (request.method === 'POST') {
      const kind = request.headers.get('X-Media-Kind') ?? '';
      const contentType = request.headers.get('Content-Type') ?? 'application/octet-stream';
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength > MAX_UPLOAD_BYTES) return fail(413, 'That file is too large.', origin);

      const ticket = await rpc<{ path: string }>(env, token, 'media_upload_ticket', {
        p_kind: kind,
        p_content_type: contentType,
        p_bytes: bytes.byteLength,
      });
      if (!ticket.ok) return fail(ticket.status, ticket.message, origin);

      try {
        await b2Upload(env, ticket.data.path, contentType, bytes);
      } catch (e) {
        // Credentials and bucket details never reach the client.
        console.error('upload failed:', (e as Error).message);
        return fail(502, 'We couldn’t save that file. Try again.', origin);
      }
      return json(
        { path: ticket.data.path, url: `${url.origin}/m/${ticket.data.path}` },
        201,
        origin,
      );
    }

    /* --------------------------------------------------------------- read */
    if (request.method === 'GET') {
      if (!path) return fail(400, 'No file requested.', origin);
      const verdict = await rpc<{ allowed: boolean; cacheable: boolean }>(env, token, 'can_view_media', {
        p_path: path,
        p_url: `${url.origin}/m/${path}`,
      });
      if (!verdict.ok) return fail(verdict.status, verdict.message, origin);
      if (!verdict.data?.allowed) return fail(404, 'That file isn’t available.', origin);

      // Only ever cache bytes every signed-in member would get — a private file
      // cached under a shared key would be served to the next caller.
      const key = `${url.origin}/m/${path}`;
      if (verdict.data.cacheable) {
        const cache = caches.default;
        const hit = await cache.match(key).catch(() => undefined);
        if (hit) return withHeaders(hit, path);
      }

      const auth = await b2Auth(env);
      const upstream = await b2Download(env, auth, path);
      if (!upstream.ok) return fail(404, 'That file isn’t available.', origin);

      const response = withHeaders(new Response(upstream.body, upstream), path);
      if (verdict.data.cacheable) {
        const cached = response.clone();
        void caches.default.put(key, cached).catch(() => undefined);
      }
      return response;
    }

    /* ------------------------------------------------------------- delete */
    if (request.method === 'DELETE') {
      if (!path) return fail(400, 'No file requested.', origin);
      const allowed = await rpc<boolean>(env, token, 'can_manage_media', {
        p_path: path,
        p_url: `${url.origin}/m/${path}`,
      });
      if (!allowed.ok) return fail(allowed.status, allowed.message, origin);
      if (!allowed.data) return fail(404, 'That file isn’t yours to remove.', origin);

      await b2Delete(env, path);
      return json({ ok: true }, 200, origin);
    }

    return fail(405, 'Unsupported method.', origin);
  },
};

/** Cache policy by kind: Moments are short-lived, chat media is never shared. */
function withHeaders(response: Response, path: string): Response {
  const kind = path.split('/')[0];
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  if (kind === 'messages') headers.set('Cache-Control', 'private, no-store');
  else if (kind === 'moments') headers.set('Cache-Control', 'public, max-age=3600');
  else headers.set('Cache-Control', 'public, max-age=604800');
  return new Response(response.body, { status: response.status, headers });
}
