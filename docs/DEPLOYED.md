# Crushly — deployed state

Updated 2026-10-29 21:55 UTC. Every number below was fetched from the running
system, not copied from a build log.

## Live

| | |
|---|---|
| Web app | https://mecrushly.vercel.app |
| Download page | https://mecrushly.vercel.app/download |
| Android | **1.0.11** · versionCode **11** |
| APK | `Crushly-1.0.11-Android9plus.apk` · **92,994,875** bytes |
| SHA-256 | `550710bd8f7b6a162ee2c9524dbf8ef4845756716b9450953c2a43177aa90e2f` |
| Release | https://github.com/dyceelvk/Crushly/releases/tag/android-test-1.0.11 |
| Worker | https://crushly-media.dyceelvk.workers.dev — `/version` reports 1.0.11 |
| Branch | `app/space-tabs-and-playback` @ `a656dbe` |

**Verified by downloading `/apk/latest` and hashing the bytes that arrived** —
92,994,875 bytes, `550710bd…aa90e2f` — matching what `/version` advertises and
what the download page quotes. The manifest inside that file was read back out
of the APK: `versionName='1.0.11' versionCode='11' package='app.crushly'`, so
the number a phone compares against is the one inside the file it installs.

The three surfaces a phone consults agree: download page, `/version`, and the
bytes actually served. They have drifted apart before — twice — which is why
this table exists and why two guards now stop it happening silently.

## What 1.0.11 puts in people's hands

Four controls that did not do what they said, in one build:

| | |
|---|---|
| **Save** | Really saves. `post_saves` + 3 RPCs, a `SavedPosts` screen, a bookmark in the Flow header and a row in Settings. Private: own rows only, no count, no notification. |
| **Circle counts** | `circle_feed` now merges `post_engagement`, so a post inside a Circle shows its like and comment counts. |
| **Vibe captions** | `Vibe.edit` was typed `VideoEdit` but the server stores a `LiveEdit`; the full-screen feed played every clip bare. Now drawn through `VideoEditCanvas`. |
| **Whisper keyboard** | Android's composer sat under the keyboard — `behavior={undefined}` does nothing once the app draws edge to edge. Now `height` on Android, `padding` on iOS. |

The database half went live ahead of the build and is backwards compatible, so
an installed 1.0.10 gained correct Circle counts immediately and gained nothing
else until it updated. The Saved screen exists only in 1.0.11 and later.

## How the release is actually announced

A phone asks the Worker what to install. That answer comes from
`cloudflare/media-worker/src/release.json`, which the Android job rewrites from
measurements of the APK it just published — size and checksum from the file,
version code read out of the APK's own manifest, never typed by a person.

**The commit is not the deploy.** A push made with the job's own `GITHUB_TOKEN`
starts no workflows, so `Deploy media Worker` never ran on it, and the Worker
went on answering with the previous version for a published 1.0.11. That is the
third time this exact shape of bug cost a release. The Android job now deploys
the Worker itself and then asks `/version` what it says, failing the release if
the answer is not the build just published.

## What is not deployed

| Surface | Carries 1.0.11? |
|---|---|
| `mecrushly.vercel.app` (production web) | **Yes** — deployed from `a656dbe`, bundle carries `save_post` / `saved_posts` |
| APK 1.0.11 (`android-test-1.0.11`, prerelease) | **Yes** — this is the build described above |
| Play Store / any store | **No** — there is no store listing; distribution is the APK |

`main` is still 280 commits behind this branch. Production web is not built
from `main`; it is deployed explicitly from `app/space-tabs-and-playback`.
Merging this branch into `main` is not required to ship and would be a separate,
much larger piece of work.

## Guards that exist now

- `CrushlyApp/scripts/check-download-page.mjs` — fails the build when the page's
  filename, size or fingerprint disagrees with what is published.
- `CrushlyApp/scripts/write-download-page.mjs` — writes those numbers from the
  APK that was just published, so nobody types them.
- `.github/scripts/update-worker-release.py` — reads `versionCode` out of the
  APK, never reuses a version code, refuses to publish a number that disagrees
  with `app.json`.
- The Android job's last step asks `/version` what it is offering and fails if
  it is not this build.
- `Deploy web app`'s last step asks `mecrushly.vercel.app` which bundle it
  serves and checks that the live JavaScript contains the controls of the
  release, when it is given a token to deploy with.

## Two builds of 1.0.11 exist, and only one is offered

The first build went to `android-test-1.0.11` at `cb55b519…`. Adding the
workflow trigger then started a second build, which clobbered the release asset
with different bytes at the same version — same filename, new fingerprint. The
release, `release.json` and the download page all describe the second build
(`550710bd…`), and `/apk/latest` serves it.

This exposed a cache bug worth knowing about: the Worker's edge cache was keyed
on the APK's **filename**, which does not change when a build is replaced, so it
kept handing out the first body while `/version` advertised the second one's
checksum. The key now carries the published fingerprint. Anyone who downloaded
in that window got a valid 1.0.11 with a checksum that did not match the page —
harmless in itself, since both files are this release, but exactly the kind of
thing an integrity check exists to catch.

## Known, unfixed

- **`VERCEL_TOKEN` is still not set.** `Deploy web app` therefore cannot publish
  the site; it now says so and skips instead of failing red on every push. Web
  deploys are done explicitly. Add the token and the workflow takes over.
- **A `.mov` recorded on a real iPhone or Samsung has never been published and
  played back on a physical device.** Everything else is proven over HTTP
  against production and inside an Android 9 emulator; the camera-roll path on
  hardware is the one open verification.
- **`Cloudflare Workers Builds` (the Cloudflare-side Git integration) is red on
  every commit.** It is a second, unused build path alongside the
  `wrangler deploy` in GitHub Actions. Either configure it or disconnect it so
  it stops being a red check that means nothing.
