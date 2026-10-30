# Crushly — the media pipeline

**Owner and official credit: Odoh chiagoziem isreal.**
Applies to version 1.0.10 (versionCode 10).

This is the end-to-end path a photo or a clip takes from a member's phone to
another member's screen, and the four places it used to break. Read this before
changing anything about uploads, storage, or playback.

---

## 1. The path, in order

```
picker (expo-image-picker)
   │  assets[0]: uri, mimeType, fileSize, duration
   ▼
client normalisation        CrushlyApp/src/lib/upload.ts
   │  clipContainer()      → 'mp4' | 'webm' | 'mov' | 'other'
   │  clipContentType()    → the Content-Type actually sent
   ▼
remux safety net            CrushlyApp/src/lib/nativeTrim.ts → remuxToMp4()
   │  stream copy, no re-encode; skipped when already mp4/webm
   ▼
ticket                      supabase → media_upload_ticket(kind, type, bytes)
   │  media_extension()    → file extension, or NULL → 415
   │  media_kind_allows()  → per-kind whitelist → 415 with a plain sentence
   │  ceilings             → 413
   │  hourly ceiling       → 429, counts published rows across every kind
   │  books a row in media_upload_reservations and returns a path
   ▼
bytes                       Cloudflare Worker  POST /m/<path>
   │  streams the body (never buffers it), weighs Content-Length
   │  checks the booked reservation, writes to Backblaze B2
   ▼
row                         create_post / create_moment / create_vibe / send_message
   │  media_insert_own  (RLS) — the post row now references the stored object
   ▼
feed                        flow_feed / public_flow_feed / space_posts / vibe feed
   ▼
playback                    GET /m/<path>  → explicit Content-Type + Accept-Ranges
```

## 2. Why it broke, and where each fix sits

The 415 `That file type is not supported.` was **not** a client validation
message and **not** the Worker. It came from Postgres, inside
`media_upload_ticket()`, before a single byte left the device:

```
media_extension('video/quicktime') → NULL → raise 415
```

`media_extension()` knew `video/mp4` and `video/webm` only. An iPhone and a
Samsung gallery both hand over `.mov` labelled `video/quicktime`, so the two
most common phones in the market were refused outright. The string the member
read was the database's own error marker, relayed verbatim by the Worker.

Four fixes, one per layer — each is separately sufficient to matter, and none of
them hides an error or weakens a policy:

| Layer | File | What it does now |
|---|---|---|
| Server accepts the container | `supabase/migrations/20261029195516_video_container_support.sql` | `media_extension()` gains `video/quicktime → mov` and `video/x-m4v → mp4`. The four duplicated per-kind sentences collapse into one `media_kind_allows()` function. Ceilings, rate limit and path booking are untouched. No executable or document type was added. |
| Client converts first | `CrushlyApp/src/lib/nativeTrim.ts`, `src/api/service.ts` | `createPost()` remuxes any non-MP4/WebM clip to MP4 on the device. Stream copy through the platform muxer: frames are unchanged, it is near-instant, and **no encoder is added to the APK**. |
| Worker stops leaking internals | `cloudflare/media-worker/src/index.ts` | Unwraps `__CRUSHLY__<status>__<code>__<message>` into a real HTTP status and a plain sentence. |
| Worker serves a real type | same | `withHeaders()` sets `Content-Type` from the file extension and advertises `Accept-Ranges: bytes`. Previously storage metadata decided the type; with `X-Content-Type-Options: nosniff`, a clip could arrive as `application/octet-stream` and download instead of play. |

### Accepted types after 1.0.10

| Kind | Extensions | Ceiling |
|---|---|---|
| `photos` | jpg, png, webp | 8 MB |
| `moments`, `posts` | jpg, png, webp, mp4, webm, mov | 80 MB |
| `circles` | jpg, png, webp, m4a, mp3, mp4, webm, mov | 80 MB |
| `vibes` | mp4, webm, mov, jpg, png, webp | 80 MB |
| `messages` | jpg, png, webp, m4a, mp3, mp4, webm, mov | 80 MB |

The hourly ceiling counts what was **published** — photos, moments, messages,
posts, circle messages, vibes — not what was reserved. This matters: a moment
with no file books no reservation, so counting reservations alone let a member
publish past the limit.

## 3. Errors a member can actually read

| Situation | What they see |
|---|---|
| Container not in the map | `That file type is not supported.` (415) |
| Wrong kind for the slot | e.g. `That takes a photo or a short clip.` (415) |
| Over the per-kind ceiling | `That file is too large to send.` (413) |
| Past the hourly ceiling | 429 with a plain sentence |
| Empty file | `That file looks empty - try picking it again.` (400) |
| Network failure mid-upload | the request error, surfaced as-is — never swallowed |

## 4. Regression tests

`CrushlyApp/src/lib/upload.test.ts` — 8 tests over the container rules
(`clipContainer`, `clipContentType`, `containerIsStorable`, `extensionFor`).
Run with the rest of the app suite:

```
cd CrushlyApp && npm test        # 118 pass / 0 fail
```

The database has its own suite (`stubs.sql` + migrations ×2 + `seed.sql` +
`comments.sql` + `smoke.sql`) which asserts the hourly ceiling, the per-kind
rules and the ticket's booking behaviour.

## 5. What is still not proven

**No `.mov` recorded on a real iPhone or Samsung has been played through the
app on a physical device.** Everything above was proven against production over
HTTP with synthetic and real-MP4 files, and `.mov` was proven at the ticket,
upload and serve layers — but not through a phone camera roll and not through
the in-app player. That is the outstanding verification.

## 6. Cloudflare Worker limits worth remembering

- 100 MB inbound request body; 128 MB isolate memory.
- The pre-1.0.9 Worker buffered the whole body into an `ArrayBuffer` to measure
  it, which is why anything past roughly 25 MB died while the database allowed
  80 MB. It now streams and weighs `Content-Length`.
