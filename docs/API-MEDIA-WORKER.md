# Crushly — the media Worker API

**Official credit: Odoh chiagoziem isreal.**
Worker: `https://crushly-media.dyceelvk.workers.dev` · source `cloudflare/media-worker/src/index.ts`

The Worker is the **only** thing that can read or write the media bucket. The
`media` bucket is private; every byte a member sees passes through here, and
every request is authorized against their Supabase session.

---

## 1. Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET`/`HEAD` | `/health` | none | liveness and configuration check |
| `GET`/`HEAD` | `/version` | none | what Android build the app should be running |
| `GET`/`HEAD` | `/apk/<name>` | none | download an Android build; `latest` is an alias |
| `POST` | `/admin/lifecycle` | `ADMIN_TOKEN` | apply B2 lifecycle rules |
| `POST` | `/m/<path>` | Bearer JWT | upload a file |
| `GET`/`HEAD` | `/m/<path>` | Bearer JWT | stream a file |
| `DELETE` | `/m/<path>` | Bearer JWT | remove a file the caller may manage |

`OPTIONS` on any path returns a CORS preflight.

Path decoding strips both a leading `/m/` and a leading `/`, so `/m/<path>` and
`/<path>` resolve the same way.

## 2. Upload

```
POST /m/<path>
Authorization: Bearer <member JWT>
Content-Type: video/quicktime
X-Media-Kind: posts
Content-Length: 4823104

<raw bytes>
```

Order of operations — this order is the contract:

1. **Auth.** `memberId(token)` is resolved against Supabase. No token →
   `401 Sign in to load this.` A dead session →
   `401 That session has expired — sign in again.`
2. **Size, without reading the body.** `Content-Length` is used when present.
   The whole body is buffered **only** when the client declares no length.
   Buffering was what killed every upload past ~25 MB in 1.0.8.
3. **Ceiling.** Past `MAX_UPLOAD_BYTES` → `413 That file is too large.`
   Zero or negative → `400 That file looks empty - try picking it again.`
4. **Ticket.** `media_upload_ticket(p_kind, p_content_type, p_bytes)` is
   called. It decides whether this kind may take this container, enforces the
   per-kind ceiling, applies the hourly ceiling, books the path, and returns it.
   Its refusal is relayed with its own status and sentence.
5. **Store.** The stream is forwarded to Backblaze B2 at the booked path.
   Nothing is buffered twice.
6. **Answer.** `201 { "path": "...", "url": "https://.../m/..." }`.

A storage failure answers `502 We couldn’t save that file. Try again.` and logs
the real cause server-side. Credentials and bucket details never reach the
client.

### Kinds

`photos` · `moments` · `messages` · `posts` · `circles` · `vibes`

### Content types accepted

| Family | Types |
|---|---|
| image | `image/jpeg`, `image/png`, `image/webp`, `image/heic` |
| audio | `audio/mpeg`, `audio/mp4`, `audio/aac`, `audio/x-m4a` |
| video | `video/mp4`, `video/webm`, `video/quicktime`, `video/x-m4v` |

Anything else → `415 That file type is not supported.`

## 3. Read

```
GET /m/<path>
Authorization: Bearer <member JWT>
Range: bytes=0-1048575        (optional)
```

1. Auth as above.
2. `can_view_media(p_path, p_url)` decides. It returns `allowed` and
   `cacheable`, so a private object is never cached at the edge.
3. The object is streamed with an **explicit `Content-Type` derived from the
   extension** — not from storage metadata — plus `Accept-Ranges: bytes` and
   `X-Content-Type-Options: nosniff`. Before this, a clip could arrive as
   `application/octet-stream` and download instead of play.
4. A cacheable `200` to a `GET` is written to the edge cache. Range requests are
   never cached.

## 4. Errors, and what a member reads

Every refusal is a JSON body `{ "error": "<sentence>" }` with a real HTTP status.

| Status | Sentence |
|---|---|
| 400 | `No file requested.` / `That file looks empty - try picking it again.` |
| 401 | `Sign in to load this.` / `That session has expired — sign in again.` |
| 403 | permission refused by `can_view_media` |
| 404 | object missing |
| 405 | `Unsupported method.` |
| 413 | `That file is too large.` |
| 415 | `That file type is not supported.` |
| 502 | `We couldn’t save that file. Try again.` |

**The `__CRUSHLY__` marker never escapes.** Database RPCs raise
`__CRUSHLY__<status>__<code>__<message>`; the Worker unwraps it into the status
and the sentence. Seeing a marker in a member's screenshot means an unwrap path
was missed — treat it as a bug.

## 5. Version advertisement

```
GET /version
{
  "platform": "android",
  "version": "1.0.10",
  "versionCode": 10,
  "minVersionCode": 3,
  "apkUrl": "https://.../apk/Crushly-1.0.10-Android9plus.apk",
  "bytes": 0,
  "sha256": "...",
  "notes": "..."
}
```

`versionCode` is read **out of the published APK**, not inferred from the
version string. The update announcer compares it against the installed build.

`/admin/lifecycle` compares a bearer token against `ADMIN_TOKEN`, and answers
`404` (not `403`) to a wrong token so the endpoint does not advertise itself.

## 6. Configuration

All of it arrives as Worker secrets at deploy time from GitHub Actions. Nothing
sensitive is committed.

| Secret | Purpose |
|---|---|
| `SUPABASE_URL` | project URL |
| `SUPABASE_ANON_KEY` | publishable key — **never** the service key |
| `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET` | Backblaze credentials |
| `ADMIN_TOKEN` | lifecycle endpoint |

## 7. Platform limits worth knowing

- 100 MB inbound request body; 128 MB isolate memory.
  **This is why the Worker must stream** — a body copied into an `ArrayBuffer`
  is copied twice, once to measure and once to forward.
- `caches.default` only stores `GET` 200s. A `Range` response must not be
  stored, or a partial body becomes the cached whole.
