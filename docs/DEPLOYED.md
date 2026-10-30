# Crushly — deployed state

Updated 2026-10-30 00:55 UTC. Every number below was fetched from the running
system, not copied from a build log.

## Live

| | |
|---|---|
| Web app | https://mecrushly.vercel.app |
| Download page | https://mecrushly.vercel.app/download |
| Android | **1.0.11** · versionCode **11** |
| APK | `Crushly-1.0.11-Android9plus.apk` · **92,994,875** bytes |
| SHA-256 | `30a7f7e19ce3798e8538551cb38979ff0cbacb62362ef1c357c8ba9c2d28ea04` |
| Release | https://github.com/dyceelvk/Crushly/releases/tag/android-test-1.0.11 |
| Worker | https://crushly-media.dyceelvk.workers.dev — `/version` reports 1.0.11 |
| Branch | `app/space-tabs-and-playback` @ `d94886c` |

**Verified by downloading `/apk/latest` and hashing the bytes that arrived** —
92,994,875 bytes, `30a7f7e1…2d28ea04` — matching what `/version` advertises,
what the download page quotes, and what `SHA256SUMS.txt` on the release says.
The GitHub release asset and the Worker's `/apk/latest` are byte-identical. The manifest inside that file was read back out
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
| `mecrushly.vercel.app` (production web) | **Yes** — deployed from `d94886c` (`dpl_D1EXjpmq48p3Ap3NCi2iBU5MpXe5`), bundle carries `save_post`, `saved_posts`, `circle_feed` |
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

## Three builds of 1.0.11 were made, and the third is the one offered

1.0.11 was built three times under the same version and the same filename. This
is not a process that failed to stop them; it is what the pipeline does when a
commit touching `CrushlyApp/**` lands on the branch, and the docs commit did
exactly that.

| Build | Fingerprint | What it was |
|---|---|---|
| First | `cb55b519…` | The original build, run `40955928947` |
| Second | `550710bd…` | Clobbered the release asset once `app/**` was added to the build trigger |
| Third | `30a7f7e1…` | Run `40963634899`, after the docs commit `42f4eaa` |

The third build is the one every surface now describes. It is not the one this
document described an hour ago, and that is the honest way to write it: the
number moved because the build ran again, not because anyone mistyped.

**Why a third build happened at all.** `docs/` does not match the build filter,
but `42f4eaa` also touched `CrushlyApp/` — so the push satisfied `paths`, Gradle
produced a fresh APK with a new fingerprint, and the job did exactly what it was
fixed to do: published it, rewrote `release.json` and the download page from its
measurements, and committed `d94886c`. Gradle is not reproducible here, so the
same source yields different bytes.

**What the fingerprint-keyed cache bought.** Because the edge cache key now
carries the checksum, the Worker served the third build the moment it was
published — no stale body, no second hand-fix. That fix paid for itself on its
first real use.

**What it did not cover.** Everything downstream of the APK. The download page
and `release.json` were corrected automatically by the job, but the *web deploy*
was not: `d94886c` was committed with the bot's token, which starts no
workflows, so `Deploy web app` never ran for it. The live page quoted
`550710bd…` for a file whose bytes were `30a7f7e1…` until a production deploy
was made by hand. This is the same bot-token hole documented above for the
Worker, one layer down — and it will recur on every rebuild until the Android
job deploys the web app too, or until the page is served dynamically rather
than baked.

## The web app's real deploy path

There is no Git integration covering this, whatever the comment in
`deploy-web.yml` says. `mecrushly`'s Vercel project has
`productionBranch: main`, and `main` is stale on purpose. Every push to
`app/space-tabs-and-playback` produces a **preview** deployment — `d94886c` got
`dpl_izv8bAEY…` within seconds — and never a production one. Production is
published by an explicit API call against a commit SHA.

That is why the web app has needed a manual deploy after each of the last four
releases: the automated path that appears to exist only ever builds previews.

## Known, unfixed

- **`VERCEL_TOKEN` is still not set**, and setting it is the whole fix for the
  manual-web-deploy problem above. `Deploy web app` cannot publish without it;
  it now says so and skips instead of failing red on every push. Add the token
  and the workflow takes over, including the step that checks the live bundle
  for this release's controls.
- **A `.mov` recorded on a real iPhone or Samsung has never been published and
  played back on a physical device.** Everything else is proven over HTTP
  against production and inside an Android 9 emulator; the camera-roll path on
  hardware is the one open verification.
- **`Cloudflare Workers Builds` (the Cloudflare-side Git integration) is red on
  every commit.** It is a second, unused build path alongside the
  `wrangler deploy` in GitHub Actions. Either configure it or disconnect it so
  it stops being a red check that means nothing.
