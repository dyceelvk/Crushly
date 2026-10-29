# Changelog

All notable changes to Crushly. Newest first.

Owner and official credit: **Odoh chiagoziem isreal**.

---

## 1.0.11 — 2026-10-29

**Version code 11.** This is the release that puts the four fixes below into
people's hands: it is the first build carrying Save, drawn Vibe captions,
correct Circle counts and the Android keyboard fix.

Upgrading from 1.0.10 is an in-app update — Settings → About → Check for
updates compares version code 11 against the 10 already installed.

Four things that were quietly wrong. None is a new feature; all four are
controls or numbers that did not do what they said.

### Fixed — the Save button now saves

It flipped a local `useState`, showed "Post saved", and forgot the post the
moment the viewer closed. There was no table to write to.

- `post_saves` (`user_id`, `post_id`, `created_at`), RLS: you may select,
  insert and delete **only your own rows**. There is deliberately no policy
  that lets a post's author find out who saved it, nothing counts saves, and
  no notification is sent. Deleting a post deletes its saves.
- `save_post(post, saved)` returns the resulting state rather than echoing the
  request, so a double tap cannot leave the icon ahead of the database.
  `post_saved(post)` answers one post; `saved_posts(limit, after)` is the
  drawer, oldest-out, shaped exactly like `flow_feed` and filtered through
  `can_view_post` so a post you can no longer see drops out on its own.
- New `SavedPosts` screen reusing `PostCard`; a bookmark in the Flow header and
  a "Saved posts" row in Settings.
- `supabase/tests/saves.sql`: save survives a read-back, saving twice is not an
  error, another member cannot read or write your drawer, a blocked author's
  post leaves the drawer and returns when unblocked, a deleted post takes its
  save with it.

### Fixed — a post inside a Circle had no like or comment count

`circle_feed` was the only function that hand-builds a post without merging
`post_engagement`, so every post in every Circle rendered a blank where the
counts go. The Feed and the Circle disagreed about the same post. Fixed in
`20261030000046_circle_feed_engagement.sql`.

`supabase/tests/post_shape.sql` now asserts the shape for every function that
returns a post (`flow_feed`, `public_flow`, `space_posts`, `circle_feed`,
`load_post`, `saved_posts`), so the next feed written by hand is checked
without anybody remembering to check it.

### Fixed — Vibes played without their captions

`Vibe.edit` was typed `VideoEdit`; the server stores a `LiveEdit`. The two are
different shapes: `VideoEdit` has `sourceDuration`, `trimStart`, `trimEnd`,
`speed`; `LiveEdit` has `captions`, `stickers`, `look`. Nothing could draw the
stored edit, so the full-screen Vibe feed played every clip bare — the filter
survived only because both types spell it the same way. The player now renders
through `VideoEditCanvas` with `editFromLive()`, and three tests in
`videoEdit.test.ts` pin the conversion.

### Fixed — the Whisper composer sat under the keyboard on Android

`KeyboardAvoidingView` had `behavior={undefined}` on Android, which does nothing
once the app draws edge to edge. The composer was hidden behind the keyboard
while you typed. Now `height` on Android and `padding` on iOS, and opening the
attachment tray dismisses the keyboard first.

### Fixed — a release could be published and never offered

The Android job publishes the APK, rewrites `release.json` from measurements of
that file, and commits it. It then relied on the push to redeploy the Worker.
It does not: **a push made with the workflow's own `GITHUB_TOKEN` starts no
workflows**, so `Deploy media Worker` never ran, and `/version` went on
answering with the previous build. This happened on 1.0.9 and again on 1.0.10 —
both had to be finished by manually dispatching the Worker deploy, and the
comment in the job claimed the opposite of what GitHub does, which is why nobody
had looked.

`build-android.yml` now deploys the Worker itself and then asks `/version` what
version it is offering, failing the release if the answer is not the build that
was just published. A release that cannot be offered is no longer reported as
green.

### Fixed — the download page carried the previous build's numbers

The page rewrites itself from the Worker when its script runs, but it also
carries a filename, a byte count and a fingerprint in the HTML for readers
whose phone does not run scripts. Those were updated by hand, and were one
release behind on both 1.0.10 and 1.0.11.

`CrushlyApp/scripts/write-download-page.mjs` now writes them from the APK that
was just put on the release, in the same commit as `release.json`. The page is
excluded from the Android workflow's `paths`, so that write cannot start a
second build at the same version.

### Fixed — a missing token made a healthy branch look broken

`deploy-web.yml` failed on **every** push with `Error: You defined "--token",
but it's missing a value` — `VERCEL_TOKEN` was never added, while the site was
being deployed another way. A permanently red check teaches everyone to scroll
past the one run that would have caught a real failure. The step now reports
the missing token and skips; when a token is present it deploys and then
confirms that `mecrushly.vercel.app` is serving a bundle containing this
release's controls.

### Changed

- `supabase/tests/run.py` no longer imports `pgserver` at module level, so a
  run against an existing Postgres (`TEST_DATABASE_URL`) works on a machine
  where that package has no wheel.
- Database inventory corrected: **39** migrations, **34** tables, **41**
  policies.
- `ci.yml` and `build-android.yml` now run on `app/**`. The branch every release
  is cut from had no CI of its own and did not build an APK on push; green
  checks on a release commit came from its pull request.

### The build

`android-test-1.0.11`, **92,994,875 bytes**, sha256
`550710bd8f7b6a162ee2c9524dbf8ef4845756716b9450953c2a43177aa90e2f`.
Verified by downloading `/apk/latest` and hashing the bytes that arrive, then
reading the manifest back out of the served file: `versionName='1.0.11'`,
`versionCode='11'`, `package='app.crushly'`.

1.0.11 was built twice, and both files were published under the same name. The
first build (`cb55b519…`) went to `android-test-1.0.11`; adding the workflow
trigger in the second commit started a second build, which clobbered the release
with different bytes at the same version. The release, `release.json` and the
download page now all describe the second one, and the Worker's edge cache is
keyed on the fingerprint so it cannot serve the first one again.

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
   `supabase/migrations/20261029195516_video_container_support.sql` extends
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
| `supabase/migrations/20261029195516_video_container_support.sql` | new — MIME map, per-kind rule, rewritten ticket |
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

### Released — and two things that were only true after a manual step

The APK published: `android-test-1.0.10`, **92,987,427 bytes**, sha256
`0f123f02…d7dc37ff`. Verified by downloading `/apk/latest` and hashing the bytes
that arrive, then extracting the launcher icon from that same file
(`res/sK.webp`, 192²) and confirming it is the heart.

Two things did **not** happen on their own:

1. **The Worker kept advertising 1.0.9.** The Android job commits `release.json`
   with the release bot's token, and a push made with that token does not trigger
   workflows — so `deploy-worker.yml` never ran for the commit that bumped the
   version. `/version` served a published 1.0.10 as 1.0.9 until the deploy was
   dispatched by hand. *A `release.json` commit is not a deployment.*
2. **The download page described the previous file.** It named
   `Crushly-1.0.10-Android9plus.apk` but still carried 1.0.9's `92,960,171`
   bytes and `eac1f018…` hash, so the page's own integrity check would have
   contradicted the download. Fixed in `aac4084` with values measured from
   `/apk/latest`, not copied from a build log.

Both are now noted in `PROJECT_CONTINUITY.md` §10 so the next release checks
`/version` and the page's numbers rather than assuming the pipeline closed the
loop.

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
- **The `Deploy web app` workflow is still red, and now misleadingly so.** It
  fails at step 7, `Deploy to Vercel`, on `1a73d1f`, `535034a`, `8ace805`,
  `55bf392` and `22f159b` alike — steps 1–6 pass, so the cause is the
  `VERCEL_TOKEN` secret, not the build. Production was deployed this release
  through Vercel's Git integration instead, and the site now serves 1.0.10. But
  the workflow stays red, which on a branch whose every other check is green
  teaches people to ignore the one check that would catch a real deploy
  breakage. Add the secret, or remove the step.

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
