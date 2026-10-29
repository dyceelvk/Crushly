# Crushly — deployed state

Updated 2026-10-29. Every number below was fetched from the running system, not
copied from a build log.

## Live

| | |
|---|---|
| Web app | https://mecrushly.vercel.app — 200 |
| Download page | https://mecrushly.vercel.app/download — 200 |
| Android | **1.0.8** · versionCode **8** |
| APK | `Crushly-1.0.8-Android9plus.apk` · **93,215,151** bytes |
| SHA-256 | `bf3fb2934fb91e755aa0552dcc9899fa18fabd9d8c108625b9261399fc59ea71` |
| Release | https://github.com/dyceelvk/Crushly/releases/tag/android-test-1.0.8 |
| Worker | https://crushly-media.dyceelvk.workers.dev |
| Branch | `app/space-tabs-and-playback` @ `03c625c` |

Verified by downloading `/apk/latest` and hashing it: the bytes on disk match
the size and fingerprint the Worker advertises, and the bundle inside carries
the comments work (`keyboardDidShow`, `This comment was deleted`,
`View comments, `). Both ABIs present (`armeabi-v7a`, `arm64-v8a`).

## What is in 1.0.8

- **Video posts actually post.** The upload path was refusing every ticket with
  `new row violates row-level security policy`. `media_insert_own` is restored,
  the per-kind ceilings are 80 MB for clips, and the ticket writes to the
  reservations table it has always referenced — a table that existed only in
  the live database and is now a migration, so a fresh environment can upload.
- **The first screen is the brand.** The app used to open on the platform's own
  splash. It now opens on the Crushly mark with "Create and discover your
  Crushes.", and holds it for 1.2 seconds rather than flashing past.
- **"Find your connection" is gone** — that copy is now "Create and discover
  your Crushes." everywhere it appeared.
- **3.7 MB smaller.** 19 icon fonts reduced to the one the app actually uses,
  plus 3.1 MB of unreferenced images and a dead component removed.
- **Update checking works again.** The version code published to phones is now
  read out of the APK rather than invented from the version string — 1.0.7
  shipped as code 7 while the Worker advertised 100018, so every installed
  phone was told forever that an update was waiting.

Verified the same way as before: `/apk/latest` downloaded here is 93,215,151
bytes with the published SHA-256, and the manifest inside reports
`versionName='1.0.8' versionCode='8'`. The download page names the same file,
size and fingerprint.

## What is in 1.0.7

- **Threaded comments, with likes** — `post_comment_threads` migration:
  `post_comments.parent_id`, `post_comment_likes` + RLS, `post_comments_feed`,
  `react_to_post_comment`. Deleting a comment that has answers empties it
  rather than taking somebody else's reply down with it.
- **One comments sheet** for the whole app (`CommentsSheet`), replacing the two
  divergent copies that PostViewer and the Flow card each had.
- **The composer stays inside the sheet and above the keyboard** — the sheet is
  measured from the top of the visible area and lifted by the measured keyboard
  height, because Android 16 with edge-to-edge no longer resizes the window.
  Its arithmetic lives in `src/lib/comments.ts` with 10 tests behind it.
- **`comment_on_post` overload removed** — the old two-argument function was
  left beside the new three-argument one, so PostgREST answered every call from
  a not-yet-updated app with `PGRST203`. Fixed in migration
  `20261029000040_fix_comment_on_post_overload`.

## Guards that exist now

- `CrushlyApp/scripts/check-download-page.mjs` — fails when the page's version,
  filename, size or fingerprint disagree with what is actually published.
- `CrushlyApp/e2e/verify-comments-ui.mjs` — 18 acceptance checks against the
  running app: no composer on the closed viewer, composer pinned inside the
  sheet, list scrolls under it, keyboard does not bury it, closing removes all
  of it. Run at 402x874 and 360x640.
- `.github/scripts/update-worker-release.py` — never reuses a versionCode.

## Known, unfixed

- The Android job commits `release.json` and then pushes; if the branch has moved
  while the emulator was booting, that push is rejected and the release facts are
  lost even though the APK published. It happened on this release (100017 was
  written and dropped; 100018 was committed by hand from the published asset).
  The fix is a fetch-and-rebase before the push.
- `deploy-web.yml` does not trigger on `app/**`, so web deploys are manual.
