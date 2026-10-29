# Changelog

All notable changes to Crushly. Newest first.

Owner and official credit: **Odoh chiagoziem isreal**.

---

## 1.0.10 — 2026-10-29

### Fixed — video posts no longer fail with "That file type is not supported."

**Root cause.** `media_upload_ticket()` is the only gate between a chosen clip
and storage. It mapped a MIME type to an extension through `media_extension()`,
which knew `video/mp4` and `video/webm` and nothing else. A `.mov` — what an
iPhone and a Samsung gallery hand over, labelled `video/quicktime` — mapped to
`null` and the function raised `415` before a byte was written. Reproduced
against production:

```
video/mp4                -> 200, mp4
video/webm               -> 200, webm
video/quicktime          -> 400  __CRUSHLY__415____That file type is not supported.
video/x-m4v              -> 400  __CRUSHLY__415____That file type is not supported.
application/octet-stream -> 400  __CRUSHLY__415____That file type is not supported.
```

The toast the member saw was the database's own error marker, relayed verbatim
by the media Worker.

**Fixes, four of them, at four different layers.**

1. **Server accepts the container.**
   `supabase/migrations/20261030000200_video_container_support.sql` extends
   `media_extension()` with `video/quicktime` → `mov` and `video/x-m4v` → `mp4`,
   and moves the per-kind rules into one `media_kind_allows()` function instead
   of four copies of the same sentence. `media_upload_ticket()` is rewritten to
   call it. Ceilings, rate limit and path booking are unchanged. No MIME type
   was added that is executable or a document.
2. **Client converts before upload.** `createPost()` remuxes any non-MP4/WebM
   clip to MP4 on the device via `remuxToMp4()` — a stream copy through the
   platform muxer, so the encoded frames are unchanged, it is near-instant, and
   no encoder is added to the APK. MP4 and WebM therefore remain the formats the
   pipeline stores; QuickTime is the safety net.
3. **Worker stops leaking internals.** It now unwraps
   `__CRUSHLY__<status>__<code>__<message>` into a real status and a plain
   sentence, so a member reads "That file type is not supported." instead of the
   marker.
4. **Worker serves media with a real type.** `withHeaders()` now sets an
   explicit `Content-Type` from the file extension and advertises
   `Accept-Ranges: bytes`. Before, storage metadata decided; combined with
   `X-Content-Type-Options: nosniff` a clip could arrive as
   `application/octet-stream` and download instead of play.

**Files changed**

| File | Why |
|---|---|
| `supabase/migrations/20261030000200_video_container_support.sql` | new — MIME map, per-kind rule, rewritten ticket |
| `CrushlyApp/src/lib/upload.ts` | `clipContainer`, `clipContentType`, `containerIsStorable` |
| `CrushlyApp/src/lib/nativeTrim.ts` | `remuxToMp4()` |
| `CrushlyApp/src/api/service.ts` | `createPost` normalises a clip before upload |
| `CrushlyApp/src/screens/flow/Flow.tsx` | passes the clip duration |
| `CrushlyApp/src/screens/common/CreatePostScreen.tsx` | passes the clip duration |
| `cloudflare/media-worker/src/index.ts` | marker unwrap, explicit media type, range header |
| `CrushlyApp/src/lib/upload.test.ts` | eight tests over the container rules |

**Verified against production.**

- Ticket: `video/quicktime` → 200 `mov`, `video/x-m4v` → 200 `mp4`,
  `video/mp4` → 200 `mp4`, `video/webm` → 200 `webm`.
- End to end: a real MP4 uploaded (201), `create_post` returned a post (200),
  the post appeared in `flow_feed` on a fresh read, and the file came back with
  `content-type: video/mp4` and `accept-ranges: bytes`.
- A `.mov` upload (201), attached to a post, served as
  `content-type: video/quicktime`.
- Refusal message: `{"error":"That file type is not supported."}` at HTTP 415,
  no marker.

### Fixed — the update announcer had no control and showed a stale version

The row could only ever offer an update on the single attempt it made at mount,
then sat behind a six-hour cache, so a member who already had the newest build
saw "You're up to date" with nothing to press. Settings now has a **Check for
updates** button that invalidates the query and re-fetches; the App version row
shows the installed build and, when one is offered, `1.0.9 → 1.0.10`; the footer
names the build number.

### Fixed — the launcher icon was the C monogram, not the Crushly heart

`assets/icon.png` — which feeds the legacy `ic_launcher` **and** the favicon —
was still the C from a later rebrand, and the heart existed only as the adaptive
foreground at 40% of the tile. Both are now the official Crushly heart, rebuilt
at 62% of the canvas so it fills a launcher tile while staying inside the safe
circle every launcher mask keeps, on `#070708`. Verified through Expo's own
prebuild: `ic_launcher.webp` at 48/72/96/144/192 px and
`ic_launcher_foreground.webp` at 108/162/216/324/432 px.

### Added — official credit

**Odoh chiagoziem isreal** is the official attribution. It appears in
**Settings → About Crushly → Credits**, in `README.md`, in
`PROJECT_CONTINUITY.md`, and in the Google Drive and Dropbox project libraries.
It is held in one constant, `APP_AUTHOR` in `src/lib/company.ts`.

### Known, not fixed in this release

- **Bookmark on the post viewer is decorative.** `toggleSave` in
  `PostViewer.tsx` flips a local `useState` and toasts "Post saved"; it makes no
  request, and there is no `post_saves` table or RPC behind it. The rail is
  correct — Like, Comment, Bookmark in that order — but the third control
  promises something it does not do. Recorded rather than quietly removed,
  because removing it would change a layout that was explicitly signed off.
- **The web deploy has been red for several releases.** `Deploy web app` fails
  at step 7, `Deploy to Vercel`, on `1a73d1f`, `535034a`, `8ace805`, `55bf392`
  and `22f159b` alike — steps 1–6 pass, the secret is missing or rejected. The
  live site is still 1.0.9. Nothing in this release fixes that; it needs the
  `VERCEL_TOKEN` secret.

---

## 1.0.9 — 2026-10-29

### Fixed — video posts could not be published at all

Three defects were stacked; each alone was enough to block a clip.

1. `extensionFor('video/mp4')` returned `m4a` — the mp4 test sat inside the
   audio branch, so every clip was filed as an audio file.
2. The media Worker read the whole body into an `ArrayBuffer` to measure it.
   Anything past roughly 25 MB died there, while the database allowed 80 MB for
   exactly those files. It now streams, and weighs the body from
   `Content-Length`.
3. A rejected upload fell back to Supabase Storage, where `upsert: true` is
   refused with `new row violates row-level security policy` — the message
   everyone read as a blocked post. That fallback is gone: it also wrote to a
   private bucket the app rewrites on read, so a "successful" fallback would
   have produced a post showing nothing.

Measured after the fix: a 60 MB clip uploads; 26 MB used to fail.

### Fixed — a C appeared before the splash screen

`assets/splash-mark.png` was a bare gradient C that no screen in the app draws.
It is now the CrushlyMark ribbon, generated from the same geometry as
`Logo.tsx`, with real transparency, and the plugin config carries
`imageWidth`, `resizeMode` and a `dark` variant.

---

## 1.0.8 — 2026-10-29

- Video posts: `media_insert_own` restored, per-kind ceilings raised to 80 MB,
  and `media_upload_reservations` turned into a migration so a fresh
  environment can upload.
- The first screen is the brand, held for 1.2 seconds.
- "Find your connection" replaced with "Create and discover your Crushes."
  everywhere.
- 3.7 MB smaller: 19 icon fonts reduced to one, 3.1 MB of unused images removed.
- Update checking fixed: the published version code is read out of the APK
  rather than invented from the version string.

## 1.0.6 – 1.0.7

Comments, VibeFeed, composer truth pass, and the first in-app update path.
