# Crushly — deployed state

Updated 2026-10-29 22:05 UTC. Every number below was fetched from the running system, not
copied from a build log.

## Live

| | |
|---|---|
| Web app | https://mecrushly.vercel.app — 200 |
| Download page | https://mecrushly.vercel.app/download — 200 |
| Android | **1.0.10** · versionCode **10** |
| APK | `Crushly-1.0.10-Android9plus.apk` · **92,987,427** bytes |
| SHA-256 | `0f123f02774e51b0b5ea12ec748d59467d4faab51d9b36f6184a0adda7dc37ff` |
| Release | https://github.com/dyceelvk/Crushly/releases/tag/android-test-1.0.10 |
| Worker | https://crushly-media.dyceelvk.workers.dev — `/version` reports 1.0.10 |
| Branch | `app/space-tabs-and-playback` @ `b646a9b` |

Verified 2026-10-29 20:30 UTC by downloading `/apk/latest` and hashing the
bytes that arrive: 92,987,427 bytes,
`0f123f02…d7dc37ff`, matching what `/version` advertises and what the download
page quotes. The launcher icon was extracted from that same APK
(`res/sK.webp`, 192², fully opaque) and inspected: it is the official
gold-to-pink Crushly heart ribbon on `#070708`, not the C monogram.

The three surfaces a phone consults now agree with each other — download page,
`/version`, and the bytes actually served. They drifted apart once before, and
that is the failure this table exists to catch.

## The database moved ahead of the app

Two changes were applied to the live database on 2026-10-29 21:50 UTC, ahead of
any build that uses them. Both are backwards compatible, which is why this was
safe to do out of order:

| | |
|---|---|
| `post_saves` + 3 RPCs | **live** — table, RLS on, 3 policies, `save_post` / `post_saved` / `saved_posts` |
| `circle_feed` | **live** — now merges `post_engagement` |

- **`post_saves`** is additive. Nothing that exists today reads it, and the app
  in the store (1.0.10) does not know it is there. Verified live: RLS on, three
  policies all of the form `user_id = me_id()`, `authenticated` may execute the
  three functions and `anon` may not, an unauthenticated call to `saved_posts`
  raises `401`, and a caller with no member identity sees zero rows.
- **`circle_feed`** was replaced with the live function plus one clause: the
  merge of `post_engagement`. A line-by-line diff against the previous
  definition shows no other difference. Posts in a Circle now come back with
  `likeCount`, `commentCount` and `liked` instead of nothing. The production
  app gains correct counts immediately; it needed no new deploy.

**Not applied as a recorded migration:** `media_upload_reservations` and
`video_container_support` exist in production under different version stamps
than the repo's filenames (`20261029195516` vs `20261030000200`). That drift
predates this change and was left alone rather than rewritten, because
rewriting migration history is how a schema becomes unreproducible.
`post_saves` **was** recorded properly and appears in the production migration
list.

## What is not deployed

The **Saved** feature is database-live but **not in any published build**:

| Surface | Carries Save? |
|---|---|
| `mecrushly.vercel.app` (production web) | **No** — bundle is `index-834e34ff…`, which contains no `save_post` |
| APK 1.0.10 | **No** — it predates the work |
| Play Store / distribution | **No** |

The Vercel project builds every push on this branch but marks them `STAGED`:
production is pinned to `main`, so previews exist and nothing is promoted. The
Android job only runs on `arena/**` pushes, so no APK was cut. Shipping the web
build is a promotion of `dpl_38dZ324L227FrEMmNg38swv8WYsg` or a merge to
`main`; cutting an APK is a manual `workflow_dispatch`.

## What was in 1.0.9

- **Video posts work, for the first time on a phone.** Three defects were
  stacked, and each one alone was enough to block a clip:

  1. `extensionFor('video/mp4')` returned `m4a`, because the mp4 test sat in the
     audio branch. Every clip was filed as an audio file and refused as an
     unsupported type.
  2. The media Worker buffered the whole upload into an `ArrayBuffer` to weigh
     it. Anything past roughly 25 MB died there — while the database had been
     raised to 80 MB for exactly those files.
  3. The rejected upload fell back to Supabase Storage, where an `upsert` is
     refused with `new row violates row-level security policy`. That message is
     what everybody read as a blocked post. The fallback is gone: it also wrote
     to a private bucket the app rewrites on read, so a "successful" fallback
     would have produced a post showing nothing.

  The Worker now streams to storage with the ceiling enforced from
  `Content-Length`, and the extension and content type are decided in one place
  with tests over the types a phone actually hands over.
- **Nothing precedes the branded screen.** The native splash was a bare gradient
  C that no screen in the app draws. `assets/splash-mark.png` is now the
  CrushlyMark ribbon itself, generated from the same geometry as `Logo.tsx`,
  with real transparency; verified through Expo's own prebuild, which writes it
  into `splashscreen_logo.png` for every density plus the night variants, on
  `#070708`.
- **A 60 MB clip uploads.** Measured against the live Worker: 60 MB accepted,
  where 26 MB used to fail.

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
- `deploy-web.yml` triggers on `app/**` now, but its **Deploy to Vercel** step
  fails on every push because the `VERCEL_TOKEN` secret is not set. Production is
  therefore deployed through Vercel's own Git integration or through the Vercel
  connector, not through that workflow. Either add the secret or delete the step
  so a red workflow stops implying the site is stale — right now it is the only
  red check on an otherwise green branch, and it trains people to ignore it.
