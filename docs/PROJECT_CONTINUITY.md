# Crushly — project continuity

**Last updated:** 2026-10-29
**Current version:** 1.0.10 (versionCode 10) — **built, published, live**
**Branch:** `app/space-tabs-and-playback` @ `aac4084`
**Owner:** Odoh chiagoziem isreal

**Where the docs live.** This file, `CHANGELOG.md` and the rest of the library
are in [`docs/`](docs/README.md) in this repo — that is the canonical copy, and
it moves with the code. Google Drive and Dropbox hold reading copies and a
source archive; see `docs/BACKUP-LOG.md`.

This document is the handover. Read it first, in a new session, before touching
anything. It says what the project is, where everything lives, what is finished,
what is not, and what to do next.

---

## 1. What Crushly is

A social and dating app: discover people, send a Crush, match, message, post to
a Flow, share Moments, join Circles. Dark theme, pink/magenta accent.

- **App:** Expo SDK 57 (React Native) for Android, iOS and web — TypeScript.
- **Backend:** Supabase (Postgres + RLS, RPC functions, Auth, Storage).
- **Media:** a Cloudflare Worker in front of a private Backblaze B2 bucket.
- **Web:** deployed on Vercel.
- **Android:** release APK built in GitHub Actions, published to GitHub
  Releases, announced to installed apps by the Worker at `/version`.

There is no server to run. The app talks to Supabase directly for data, and to
the Worker for media and for the update announcement.

## 2. Official credit

**Odoh chiagoziem isreal** is the official attribution for the Crushly
application. It appears in:

- the app: **Settings → About Crushly → Credits** (`src/lib/company.ts`,
  `APP_AUTHOR`; rendered in `src/screens/settings/Settings.tsx`);
- `README.md`;
- this document;
- the Google Drive project library and the Dropbox backup snapshot.

Preserve it in every future update, release and backup. Do not substitute
another name. The constant exists so it cannot drift: change it in one place
(`APP_AUTHOR`) and the app, the docs and the release copy all follow.

## 3. Repository map

```
CrushlyApp/                 the app
  app.json                  version, versionCode, icon set, splash, plugins
  src/api/client.ts         Supabase client, media upload, error mapping
  src/api/service.ts        every backend call, one function per operation
  src/api/hooks.ts          react-query hooks
  src/lib/upload.ts         file extensions and clip containers  ← tested
  src/lib/nativeTrim.ts     on-device lossless trim + MOV→MP4 remux
  src/lib/company.ts        company copy and the official credit
  src/screens/…             onboarding, auth, discover, flow, messages,
                            moments, circles, settings, common composers
  src/components/…          design system: Layout, Txt, Button, ListRow,
                            Photo, Logo, CommentsSheet, BottomSheet, Toast
  public/download/index.html  the download page (baked-in size + sha256)
  scripts/check-download-page.mjs  fails the build if the page drifts
cloudflare/media-worker/    the media Worker
  src/index.ts              upload, read, delete, /version, /apk
  src/release.json          which build /version announces
supabase/migrations/        38 migrations — the schema of record
supabase/tests/stubs.sql    stubs that let every migration run on bare Postgres
DEPLOYED.md                 what is live right now, with measured numbers
APK-SIZE.md                 why the APK is the size it is
SECURITY.md                 security posture
PROJECT_CONTINUITY.md       this file
CHANGELOG.md                what changed, by version
```

## 4. How media works

This is the part that breaks, so it is written out in full.

1. **Pick.** `ImagePicker` returns a `uri`, a `mimeType` and a duration. The
   duration matters — see step 3.
2. **Classify.** `clipContainer()` in `src/lib/upload.ts` decides what the file
   is from its extension first and the picker's claim second. **MP4 and WebM are
   the only containers the server accepts as-is.**
3. **Normalise.** `createPost()` in `src/api/service.ts`: anything that is not
   MP4/WebM is remuxed to MP4 on the device by `remuxToMp4()`
   (`src/lib/nativeTrim.ts`). That is a stream copy through the platform muxer —
   same encoded frames, new container, no re-encode, no encoder in the APK.
4. **Ticket.** The Worker asks Supabase for `media_upload_ticket(kind,
   content_type, bytes)`. **This is where a 415 comes from.** It maps the MIME
   type to an extension (`media_extension`) then checks the extension is allowed
   for that kind (`media_kind_allows`) and the size is under the ceiling
   (80 MB for posts/messages/circles/vibes, 8 MB otherwise), and books a row in
   `media_upload_reservations` (40 uploads/hour).
5. **Upload.** The Worker streams the body to B2 and returns
   `{ path, url }`. The body is **weighed from `Content-Length`, never
   buffered** — buffering is what used to cap uploads at ~25 MB.
6. **Record.** `create_post(...)` writes the row. It is `SECURITY DEFINER`, so
   the row insert itself never trips RLS.
7. **Read.** `GET /m/<path>` checks `can_view_media`, then serves the bytes with
   an **explicit `Content-Type` derived from the extension** and
   `Accept-Ranges: bytes`. Without the explicit type, `nosniff` made a clip
   download instead of play.

**Never** add a client-side fallback that writes media to the Supabase `media`
bucket. That bucket is private and does not hold the moved kinds, so the app
rewrites those paths back to the Worker on read and the file appears missing.
There was such a fallback; it produced "new row violates row-level security
policy" for files that had nothing to do with row policies, and it was removed.

## 5. Update announcement

- The Worker answers `/version` from `src/release.json`.
- The Android workflow measures the APK it just built, writes those numbers into
  `release.json`, and commits them. Committing it redeploys the Worker.
- The app reads that and compares `versionCode` against the build it is running
  (`useAppUpdate` in `src/api/hooks.ts`).
- **Settings → App** shows the installed version, offers the new one, and has a
  **Check for updates** button.

`release.json` and the installed APK must agree. If they disagree, the phone
will be offered a build it already has — or never offered one it needs.

## 6. Release checklist

1. Bump `version` and `android.versionCode` in `CrushlyApp/app.json`. **Both.
   The versionCode is what a phone compares; it must only ever go up.**
2. Update `id="filename"` in `CrushlyApp/public/download/index.html` to the new
   version. `node scripts/check-download-page.mjs` fails the build if you forget.
3. `npx tsc --noEmit` and `npm test` in `CrushlyApp`.
4. Push, then dispatch **Build Android test APK**. It publishes the APK,
   measures it, and commits `release.json`.
5. Dispatch **Deploy media Worker** if `release.json` changed — the bot's commit
   does not always trigger it.
6. Put the measured byte count and SHA-256 on the download page, and confirm
   `npx node scripts/check-download-page.mjs` passes.
7. Deploy the web app to Vercel as **production** with the exact commit SHA.
   A push only makes a staged preview on this branch.
8. Confirm all four agree: APK on disk, `/version`, the download page, and the
   web app.

## 7. Known issues

| | Status |
|---|---|
| Video posts failing with 415 | **Fixed in 1.0.10** — see CHANGELOG |
| Settings showed 1.0.8 and no update control | **Fixed in 1.0.10** — version row and Check for updates button |
| Launcher icon showed the C monogram, not the heart | **Fixed in 1.0.10** — official heart rebuilt at every density |
| `Chat.tsx` keyboard covers the composer | Open |
| Multi-image posts (needs a `post_media` table) | Open — one attachment per post for now |
| `circle_feed` returns no engagement | Open |
| Comment hooks never invalidate `keys.post(id)` | Open |
| `setTool(null)` overwrites `initialTool` | Open |
| `VibeFeed` ignores `vibe.edit` | Open |
| `VibeAuthor` has no `hasMoment` | Open |
| No persistent E2E seed account | Open |
| **Bookmark on the post viewer is client-only.** `toggleSave` flips local state and toasts "Post saved" — nothing is written. There is no `post_saves` table and no RPC. The button lies. | Open |
| `VERCEL_TOKEN` secret missing → `deploy-web` job red on **every** commit, including `535034a`. Steps 1–6 pass; step 7 `Deploy to Vercel` fails. The live site therefore still serves 1.0.9. | Open — deploy Vercel by hand |

## 8. Database

**39** migrations in `supabase/migrations/`, all applied. Next migration must
sort after `20261030000400`.

Core tables — this list is checked against the migrations, not remembered:
`profiles`, `preferences`, `privacy`, `photos`, `posts`, `post_comments`,
`post_comment_likes`, `post_reactions`, `crushes`, `passes`, `connections`,
`keeps`, `conversations`, `messages`, `message_reactions`, `call_rooms`,
`moments`, `moment_views`, `moment_reactions`, `vibes`, `vibe_views`,
`circles`, `circle_members`, `circle_messages`, `blocks`, `reports`,
`notifications`, `notification_settings`, `verification_requests`,
`reserved_usernames`, `didit_events`, `media_upload_reservations`,
`media_cleanup_log`, `post_saves`. Every one has RLS enabled — 34 tables, 41
policies.

There is **no** `post_likes`, `post_bookmarks` or `comments` table. A post like
is a row in `post_reactions`; a post comment is `post_comments`; a saved post is
a row in `post_saves` (added 2026-10-30 — see item 3 below, now done).

Two storage buckets, both private: `media` (80 MB ceiling) and `verification`.

Everything a client writes goes through an RPC. `posts` has a SELECT policy and
**no INSERT policy, deliberately** — the insert happens inside
`create_post()`, which is `SECURITY DEFINER`.

## 9. Continuing this work

- Push races the release bot: always `git fetch` + `git rebase FETCH_HEAD`
  before pushing.
- Never copy a size or hash from a log onto the download page. Measure the file
  the Worker is actually serving.
- `aapt`, `aapt2` and `$ANDROID_HOME` are absent in the agent sandbox. Verify
  Android resources by running `npx expo prebuild --platform android` in a
  scratch copy and reading `android/app/src/main/res/`.
- The Supabase connector runs one statement per transaction and needs a
  `project_ref`.
- Do not regenerate migration history.

## 10. Next steps, in order

1. ~~Confirm 1.0.10 builds, publishes and announces itself.~~ **Done.** The APK
   published to `android-test-1.0.10` (92,987,427 bytes), the Worker advertises
   it at `/version`, and the download page quotes the same size and hash. The
   heart icon was verified by extracting `res/sK.webp` from the served APK.
   Still outstanding: seeing it on a real launcher after a fresh install.

   Two things had to be done by hand to close this release, and the second one
   is a real defect in the process rather than a one-off:

   - **The Worker did not pick up `release.json` on its own.** The Android job
     commits `release.json` with the release bot's token, and a push made with
     that token does not trigger workflows. `/version` kept advertising 1.0.9
     for a published 1.0.10 until `deploy-worker.yml` was dispatched manually.
     `release.json` naming a version is **not** the same as the Worker serving
     it — always check `/version` after a release.
   - **The download page quoted the previous build's size and hash.** It said
     1.0.10 but carried 1.0.9's numbers, so its own integrity check would have
     contradicted the file a member downloaded. Fixed in `aac4084` from values
     measured off `/apk/latest`.
2. Post a real `.mov` from an iPhone/Samsung gallery and confirm it posts and
   plays. **This is the one thing that has not been tested on a device.**
3. ~~**Make Bookmark real, or remove it.**~~ **Done 2026-10-30.** `post_saves`
   (RLS: own rows only, no SELECT for anybody else), `save_post`,
   `post_saved` and `saved_posts`, a `SavedPosts` screen, a bookmark in the
   Flow header and a row in Settings. Saving is private: nothing counts it and
   the author is never notified. Proven by `supabase/tests/saves.sql`.
4. `post_media` migration, so a post can carry more than one image.
5. ~~`Chat.tsx` keyboard fix.~~ **Done 2026-10-30.** Android had
   `behavior={undefined}`, which does nothing once the app draws edge to edge,
   so the composer sat under the keyboard. Now `height` on Android, `padding`
   on iOS, and the attachment tray closes the keyboard before it opens.

**Also fixed 2026-10-30, found while testing the above:**

- **`circle_feed` returned posts with no like or comment count.** It was the
  only function that builds a post by hand without merging
  `post_engagement`. Every post inside a Circle showed blank where the counts
  go. Fixed in `20261030000400_circle_feed_engagement.sql`, and
  `supabase/tests/post_shape.sql` now asserts the shape for *every*
  post-returning function so the next hand-written feed cannot repeat it.
- **Every Vibe in the full-screen feed played without its captions.** `Vibe.edit`
  was typed as `VideoEdit` when the server stores a `LiveEdit`, so nothing could
  read it; the filter survived by accident of naming. The player now draws
  through `VideoEditCanvas`. Pinned by three tests in `videoEdit.test.ts`.
6. Add `VERCEL_TOKEN` so the web deploy stops needing a manual step. Until then
   **every** push leaves `Deploy web app` red and the live site on the previous
   build, which is how a member ends up on 1.0.9 after a 1.0.10 release.
7. Persistent E2E seed account, so the browser tests stop depending on a
   throwaway signup.
