# Crushly — deployed state

Last verified: 2026-10-29 (all figures below were fetched, not assumed).

## The app

| | |
|---|---|
| Web app | https://mecrushly.vercel.app — 200 |
| Bundle | `_expo/static/js/web/index-695320e56b1fa4820ba61c6744c16e7f.js` (2,393,277 B) |
| Branch | `app/space-tabs-and-playback` @ `b56ac73` |
| CI | green on `b56ac73` (all four jobs) |

## The Android download

| | |
|---|---|
| Page | https://mecrushly.vercel.app/download |
| Link | `https://crushly-media.dyceelvk.workers.dev/apk/latest` |
| Version | **1.0.6** · versionCode 6 · Worker code 100014 |
| File | `Crushly-1.0.6-Android9plus.apk` |
| Size | 94,980,255 bytes |
| SHA-256 | `da4ca63339390b968032551a585e1ab78d444bef326d13a41d26ada3913eafbb` |
| ABIs | `armeabi-v7a`, `arm64-v8a` |
| minSdk / targetSdk | 28 / 36 |

Verified by downloading the file end to end and matching the checksum, then
reading the bundle inside the APK: `controlPlacement`, `showSoundHint`,
`hasMoment`, `space_posts`, `Pause clip`, `No follower/Flow` strings all present.

## How a release reaches the page

```
build-android.yml        compile + verify + emulator smoke + secret audit
        |                (universal ARM, both ABIs)
        v
GitHub release           android-test-<version>  <-- uploaded with --clobber,
        |                                              then re-read and compared
        v
update-worker-release.py release.json (bytes + sha measured from the real file)
        |
        v
deploy-worker.yml        Worker /version and /apk/latest
        |
        v
/download                reads /version on load; HTML fallback points at
                         /apk/latest and prints the same numbers
```

`deploy-worker.yml` only listens on `main` and `arena/**`, so a release cut on
an `app/**` branch needs it dispatched by hand:
`POST /actions/workflows/deploy-worker.yml/dispatches {"ref": "<branch>"}`.

## Two defects fixed this round

1. **The release kept yesterday's APK.** The publish step skipped its upload
   when an asset of that name already existed, then measured the local file and
   advertised those numbers. 1.0.5 was already on the release, so the page
   offered a day-old build under a fresh checksum. It now uses `--clobber` and
   re-reads the release, failing if size or digest disagree with what it built.

2. **The page's no-JavaScript link rotted into a 404.** A filename baked into
   the HTML goes stale every release. The Worker now answers `/apk/latest`, and
   `scripts/check-download-page.mjs` runs inside `npm test` so the baked-in
   version/size/sha can no longer drift from `release.json` unnoticed.

## Also fixed: the DB smoke suite was red

`supabase/tests/smoke.sql` had two faults of its own — a variable declared in a
block it was not used in, and a ring assertion that ran after earlier blocks had
left the Space crowded with live Moments, so the ring was correctly lit and the
test was wrong. Both fixed; the suite now clears the Space before asking, and
checks the owner, a stranger, and somebody close.
