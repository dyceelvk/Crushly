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

import release from './release.json';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  B2_KEY_ID: string;
  B2_APPLICATION_KEY: string;
  B2_BUCKET: string;
  /** Optional. Without it /admin/lifecycle stays closed. */
  ADMIN_TOKEN?: string;
}

/**
 * How long each kind of media is kept, in days. A Moment is gone tomorrow, and
 * that is enforced by the bucket itself rather than by a job of ours, so it
 * holds even if nothing runs.
 */
const LIFECYCLE = {
  moments: { hideAfterDays: 1, deleteAfterDays: 1 },
} as const;

const AUTHORIZE_URL = 'https://api.backblazeb2.com/b2api/v2/b2_authorize_account';
const AUTH_TTL_MS = 23 * 60 * 60 * 1000; // B2 tokens last 24h; refresh early
// Match the database and app's largest allowed media; the ticket still enforces
// smaller per-kind limits (e.g. photos and Moments).
const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;

/**
 * Backblaze wants a SHA-1 with every upload, and hashing is the only real work
 * this Worker does — on the free plan the whole request gets 10 ms of CPU,
 * which is about 4 MB of hashing. Photos and Moments are small, so they are
 * checked properly. A minute-long video note would blow the budget on its own
 * and being over the limit fails the upload outright, and those go up
 * unverified: the connection is TLS in both directions, so the bytes cannot
 * change in flight, and Backblaze still stores a checksum of what it received,
 * marked `unverified:`. Being unverifiable is not being unprotected.
 */
const VERIFIED_SHA1_MAX_BYTES = 4 * 1024 * 1024;

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

type Lifecycle = { prefix: string; hideAfterDays: number | null; deleteAfterDays: number | null };

type B2Auth = {
  token: string;
  apiUrl: string;
  downloadUrl: string;
  bucketId: string;
  bucketType: string;
  accountId: string;
  lifecycle: Lifecycle | null;
  rules: Lifecycle[];
  exp: number;
};

let b2: Promise<B2Auth> | null = null;

/** Which setup value is wrong. Only the category is ever reported. */
class B2Error extends Error {
  constructor(
    readonly kind: 'auth' | 'bucket',
    readonly buckets?: number,
    readonly caseMismatch?: boolean,
    readonly status?: number,
    readonly detail?: string | null,
  ) {
    super(kind);
  }
}

async function authorize(env: Env): Promise<B2Auth> {
  // Trimmed: a stray space or newline picked up while copying is enough for
  // Backblaze to reject the key, and it is invisible in the GitHub UI.
  const keyId = (env.B2_KEY_ID ?? '').trim();
  const applicationKey = (env.B2_APPLICATION_KEY ?? '').trim();
  const res = await fetch(AUTHORIZE_URL, {
    headers: { Authorization: `Basic ${btoa(`${keyId}:${applicationKey}`)}` },
  }).catch(() => null);
  if (!res?.ok) throw new B2Error('auth'); // keyID or applicationKey refused
  const data = (await res.json()) as {
    authorizationToken: string;
    apiUrl: string;
    downloadUrl: string;
    accountId: string;
  };

  const buckets = await fetch(`${data.apiUrl}/b2api/v2/b2_list_buckets`, {
    method: 'POST',
    headers: { Authorization: data.authorizationToken },
    // accountId is required and comes from the authorize response above —
    // without it Backblaze rejects the call, which looks exactly like a
    // missing bucket. Unfiltered on purpose: filtering by name here would
    // make a wrong name look like "no buckets at all".
    body: JSON.stringify({ accountId: data.accountId }),
  });
  if (!buckets.ok) {
    const detail = (await buckets.json().catch(() => null)) as { status?: number; message?: string } | null;
    throw new B2Error('bucket', undefined, false, buckets.status, detail?.message ?? null);
  }
  const list = (await buckets.json()) as {
    buckets: {
      bucketId: string;
      bucketName: string;
      bucketType?: string;
      lifecycleRules?: { fileNamePrefix?: string; daysFromUploadingToHiding?: number | null; daysFromHidingToDeleting?: number | null }[];
    }[];
  };
  const wanted = (env.B2_BUCKET ?? '').trim();
  let bucket = list.buckets.find((b) => b.bucketName === wanted);
  if (!bucket) {
    // Bucket names are case-sensitive, and a capital letter is easy to copy
    // wrong. Look without case before giving up.
    const loose = list.buckets.find((b) => b.bucketName.toLowerCase() === wanted.toLowerCase());
    throw new B2Error('bucket', list.buckets.length, !!loose);
  }

  // The rule that makes "Moments disappear after 24 hours" true at the storage
  // layer, whether or not our own jobs run. Reported by /health.
  //
  // Prefixes are compared ignoring a trailing slash, because the dashboard's
  // prefix box is just as happy with `moments` as `moments/`, and a rule with
  // no prefix at all would quietly delete profile photos too.
  const rules: Lifecycle[] = (bucket.lifecycleRules ?? []).map((r) => ({
    prefix: r.fileNamePrefix ?? '',
    hideAfterDays: r.daysFromUploadingToHiding ?? null,
    deleteAfterDays: r.daysFromHidingToDeleting ?? null,
  }));
  // A trailing slash is ignored, because the dashboard's prefix box is just as
  // happy with `moments` as `moments/` and the two must not look different here.
  const ruleFor = (prefix: string) => rules.find((r) => r.prefix.replace(/\/+$/, '') === prefix) ?? null;
  const lifecycle = ruleFor('moments');

  return {
    token: data.authorizationToken,
    apiUrl: data.apiUrl,
    downloadUrl: data.downloadUrl,
    bucketId: bucket.bucketId,
    bucketType: bucket.bucketType ?? 'unknown',
    accountId: data.accountId,
    lifecycle,
    rules,
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
      'X-Bz-Content-Sha1':
        bytes.byteLength <= VERIFIED_SHA1_MAX_BYTES
          ? hex(await crypto.subtle.digest('SHA-1', bytes))
          : 'do_not_verify',
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

  // A fresh lookup, not the cached one: this endpoint is how a corrected
  // bucket setting gets confirmed, and a 23-hour cache would keep reporting
  // the old value long after it was fixed.
  let storage: {
    b2: boolean;
    bucketPrivate: boolean;
    momentsLifecycle: Lifecycle | null;
    lifecycleRules?: Lifecycle[];
    problem?: 'auth' | 'bucket';
    lengths?: { keyId: number; applicationKey: number };
    bucketsVisible?: number;
    bucketNameLength?: number;
    caseMismatch?: boolean;
    listStatus?: number;
    listMessage?: string | null;
  } = { b2: false, bucketPrivate: false, momentsLifecycle: null };
  try {
    const auth = await authorize(env);
    storage = {
      b2: true,
      bucketPrivate: auth.bucketType === 'allPrivate',
      momentsLifecycle: auth.lifecycle,
      lifecycleRules: auth.rules,
    };
  } catch (e) {
    if (e instanceof B2Error) {
      storage.problem = e.kind;
      // Lengths only, never the values: a real keyID is ~24 characters, so a
      // short one means the key's *name* was pasted by mistake.
      if (e.kind === 'auth') {
        storage.lengths = {
          keyId: (env.B2_KEY_ID ?? '').trim().length,
          applicationKey: (env.B2_APPLICATION_KEY ?? '').trim().length,
        };
      } else {
        // Counts and lengths only, never names or values.
        storage.bucketsVisible = e.buckets ?? 0;
        storage.bucketNameLength = (env.B2_BUCKET ?? '').trim().length;
        storage.caseMismatch = e.caseMismatch ?? false;
        // Backblaze's own message and status, so the next failure explains
        // itself instead of being guessed at.
        if (e.status !== undefined) storage.listStatus = e.status;
        if (e.detail) storage.listMessage = e.detail;
      }
    }
  }

  const ok =
    supabase &&
    storage.b2 &&
    storage.bucketPrivate &&
    (storage.momentsLifecycle?.deleteAfterDays ?? 0) >= 1;
  return json({ ok, supabase, ...storage }, ok ? 200 : 503, origin);
}

/* -------------------------------------------------------------- upkeep */

/**
 * Puts the two retention rules on the bucket and leaves every other rule
 * alone. Closed unless ADMIN_TOKEN is set, and it never answers a GET, so the
 * endpoint gives away nothing about whether it exists.
 *
 *   curl -X POST -H 'Authorization: Bearer $ADMIN_TOKEN' \
 *        https://crushly-media.dyceelvk.workers.dev/admin/lifecycle
 */
async function applyLifecycle(env: Env, origin: string | null): Promise<Response> {
  if (!env.ADMIN_TOKEN) return fail(404, '', origin);

  try {
    const auth = await b2Auth(env);

    // b2_update_bucket replaces the whole list, so the rules already there are
    // carried over and only ours are added or corrected.
    const wanted: Record<string, { fileNamePrefix: string; daysFromUploadingToHiding: number; daysFromHidingToDeleting: number }> = {};
    for (const r of auth.rules) {
      const key = r.prefix.replace(/\/+$/, '');
      if (key === 'moments') continue; // replaced below
      wanted[key] = {
        fileNamePrefix: r.prefix,
        daysFromUploadingToHiding: r.hideAfterDays ?? 0,
        daysFromHidingToDeleting: r.deleteAfterDays ?? 0,
      };
    }
    for (const [kind, rule] of Object.entries(LIFECYCLE)) {
      wanted[kind] = {
        fileNamePrefix: `${kind}/`,
        daysFromUploadingToHiding: rule.hideAfterDays,
        daysFromHidingToDeleting: rule.deleteAfterDays,
      };
    }

    const res = await fetch(`${auth.apiUrl}/b2api/v2/b2_update_bucket`, {
      method: 'POST',
      headers: { Authorization: auth.token },
      body: JSON.stringify({
        accountId: auth.accountId,
        bucketId: auth.bucketId,
        bucketType: auth.bucketType,
        lifecycleRules: Object.values(wanted),
      }),
    });
    const body = (await res.json().catch(() => null)) as { lifecycleRules?: unknown[]; message?: string } | null;
    if (!res.ok) return fail(502, body?.message ?? 'Backblaze would not update the bucket.', origin);

    // The next request must see the new rules, not the cached ones.
    b2 = null;
    return json({ ok: true, rules: Object.values(wanted) }, 200, origin);
  } catch (e) {
    return fail(502, e instanceof Error ? e.message : 'Could not reach Backblaze.', origin);
  }
}

/* ---------------------------------------------------------------- the build */

/**
 * What the current Android build is, as the app is told about it.
 *
 * These facts live in `release.json` rather than in code because they are not
 * written by a person: the Android workflow rewrites that file after a build
 * passes its tests, so a release can never be published without the Worker
 * being told about it in the same breath.
 *
 * `assetApi` is deliberately not what the app is handed. It lets the Worker
 * mint a fresh, short-lived CDN redirect for each download instead of proxying
 * a large APK. `versionCode` only ever goes up — a reused one would make an
 * update invisible to a phone that already installed it.
 */
type AndroidBuild = { assetApi: string };

// `assetApi` returns a fresh, expiring `release-assets.githubusercontent.com`
// URL. We redirect the browser to that URL instead of streaming a 95 MB APK
// through this Worker; a failed upstream request can therefore never be saved
// as JSON under an `.apk` filename and handed to Android's package parser.
const BUILDS: Record<string, AndroidBuild> = {
  [release.file]: { assetApi: release.assetApi },
};

const RELEASE = {
  version: release.version,
  versionCode: release.versionCode,
  minVersionCode: release.minVersionCode,
  file: release.file,
  notes: release.notes,
} as const;

const RELEASE_ASSET_HOSTS = new Set([
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
]);
const SIGNED_ASSET_CACHE_SECONDS = 45 * 60;

function publicAssetUrl(location: string): string | null {
  try {
    const parsed = new URL(location);
    return RELEASE_ASSET_HOSTS.has(parsed.hostname) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function signedAssetCacheKey(build: AndroidBuild): Request {
  // The key contains only public release metadata. The cache body holds the
  // short-lived URL and lives at Cloudflare, never in a phone or a browser cache.
  return new Request(`https://crushly-media.dyceelvk.workers.dev/.internal/apk-url/${encodeURIComponent(build.assetApi)}`);
}

/** Obtain a short-lived GitHub CDN URL without exposing a repository download page. */
async function signedAssetUrl(build: AndroidBuild): Promise<string | null> {
  const cacheKey = signedAssetCacheKey(build);
  const cached = await caches.default.match(cacheKey).catch(() => null);
  if (cached) {
    const location = publicAssetUrl(await cached.text().catch(() => ''));
    if (location) return location;
  }

  const response = await fetch(build.assetApi, {
    headers: {
      Accept: 'application/octet-stream',
      'User-Agent': 'Crushly Android download',
    },
    // We want GitHub's short-lived CDN location, not a Worker relay of the APK.
    redirect: 'manual',
  }).catch(() => null);
  if (!response || response.status < 300 || response.status >= 400) return null;
  const location = publicAssetUrl(response.headers.get('Location') ?? '');
  if (!location) return null;

  // GitHub's CDN URLs last about an hour. Caching one for 45 minutes avoids
  // GitHub API rate limits during a release while always expiring it early.
  await caches.default.put(cacheKey, new Response(location, {
    headers: { 'Cache-Control': `public, max-age=${SIGNED_ASSET_CACHE_SECONDS}` },
  })).catch(() => undefined);
  return location;
}

function redirectToAsset(location: string, origin: string | null): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      // The signed destination is short-lived. Never let a browser reuse it
      // after it expires; the next tap mints a new one.
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      ...cors(origin),
    },
  });
}

async function downloadRedirect(build: AndroidBuild, origin: string | null): Promise<Response> {
  const location = await signedAssetUrl(build);
  if (!location) {
    return fail(503, 'The Android download is temporarily unavailable. Please return to Crushly and try again; do not open a partial .apk file.', origin);
  }
  return redirectToAsset(location, origin);
}

/**
 * The update check is intentionally tiny. The actual download is a redirect
 * endpoint without an `.apk` suffix, so a transient upstream error is rendered
 * as an error page rather than passed to Android as a malformed package.
 */
async function appVersion(url: URL, origin: string | null): Promise<Response> {
  const known = Object.prototype.hasOwnProperty.call(BUILDS, RELEASE.file);
  return new Response(
    JSON.stringify({
      platform: 'android',
      version: RELEASE.version,
      versionCode: RELEASE.versionCode,
      minVersionCode: RELEASE.minVersionCode,
      apkUrl: known ? `${url.origin}/download` : null,
      downloadInfoUrl: known ? `${url.origin}/download-info` : null,
      bytes: release.bytes,
      sha256: release.sha256,
      notes: RELEASE.notes,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
        ...cors(origin),
      },
    },
  );
}

/** JSON form for the web download page; it only enables a button after GitHub gave us a real CDN URL. */
async function downloadInfo(origin: string | null): Promise<Response> {
  const build = BUILDS[RELEASE.file];
  if (!build) return fail(503, 'The Android download is not configured yet.', origin);
  const downloadUrl = await signedAssetUrl(build);
  if (!downloadUrl) return fail(503, 'The Android download is temporarily unavailable. Please try again shortly.', origin);
  return json({
    version: RELEASE.version,
    file: RELEASE.file,
    bytes: release.bytes,
    sha256: release.sha256,
    downloadUrl,
  }, 200, origin, { 'Cache-Control': 'no-store' });
}

/** Kept for previously shared `/apk/<file>` links; they now use the safer redirect too. */
async function apkBuild(url: URL, origin: string | null): Promise<Response> {
  const name = decodeURIComponent(url.pathname.replace(/^\/apk\//, ''));
  const build = BUILDS[name];
  if (!build) return fail(404, 'That build isn’t available.', origin);
  return downloadRedirect(build, origin);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const head = cors(origin);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: head });
    if (url.pathname === '/health') return health(env, origin);
    if (url.pathname === '/admin/lifecycle') {
      if (request.method !== 'POST') return fail(405, 'Unsupported method.', origin);
      if (bearerToken(request, null) !== (env.ADMIN_TOKEN ?? '')) return fail(404, '', origin);
      return applyLifecycle(env, origin);
    }

    // What version the app should be running. Public, and deliberately silent
    // about where the build comes from.
    if (url.pathname === '/version') {
      if (request.method !== 'GET' && request.method !== 'HEAD') return fail(405, 'Unsupported method.', origin);
      return appVersion(url, origin);
    }

    // `/download` is what native update links open. It has no .apk suffix, so
    // an upstream outage becomes an error page rather than a malformed package.
    if (url.pathname === '/download') {
      if (request.method !== 'GET' && request.method !== 'HEAD') return fail(405, 'Unsupported method.', origin);
      const build = BUILDS[RELEASE.file];
      return build ? downloadRedirect(build, origin) : fail(503, 'The Android download is not configured yet.', origin);
    }
    if (url.pathname === '/download-info') {
      if (request.method !== 'GET') return fail(405, 'Unsupported method.', origin);
      return downloadInfo(origin);
    }
    // Kept for links shared before the safer resolver existed.
    if (url.pathname.startsWith('/apk/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return fail(405, 'Unsupported method.', origin);
      return apkBuild(url, origin);
    }

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
        const message = (e as Error).message ?? '';
        console.error('upload failed:', message);
        // Only an upstream stage and status are exposed, never credentials,
        // paths, upstream response bodies or personal data.
        const match = /^B2 (upload url|upload) failed \((\d{3})\)$/.exec(message);
        return json({ error: 'We couldn’t save that file. Try again.',
          diagnostic: match ? `${match[1]}:${match[2]}` : 'storage-unavailable' }, 502, origin);
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
