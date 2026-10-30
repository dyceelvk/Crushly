# Crushly — deployed state

Updated 2026-10-30 08:05 UTC. Every number below was fetched from the running
system, not copied from a build log.

## Live

| | |
|---|---|
| Web app | https://mecrushly.vercel.app |
| Download page | https://mecrushly.vercel.app/download |
| Android | **1.0.11** · versionCode **11** |
| APK | `Crushly-1.0.11-Android9plus.apk` · **92,997,339** bytes |
| SHA-256 | `7df683a681bb759bbe6e1d8ff3796f432d6a4f0fc79eaf36133222e2ba60d490` |
| Release | https://github.com/dyceelvk/Crushly/releases/tag/android-test-1.0.11 |
| Worker | https://crushly-media.dyceelvk.workers.dev — `/version` reports 1.0.11 |
| Branch | `app/space-tabs-and-playback` @ `d94886c` |

**Verified by downloading `/apk/latest` and hashing the bytes that arrived** —
92,997,339 bytes, `7df683a6…ba60d490` — matching what `/version` advertises,
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

**Build 4 carries two more changes**, both fixes to things that were wrong
rather than new features:

| | |
|---|---|
| **Feed clip sizing** | A Flow clip was sized from the window while the card it sits in is 40pt narrower, so the picture hung past the card's edge and read as zoomed and cropped. The frame now comes from the clip's own ratio, measured against the card. |
| **The credit** | The old About credit block is gone from Settings; a Credits link remains under Support. The attribution now appears in the Terms of service (§20), the Privacy policy (§15) and a Credits page. |

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

## Four builds of 1.0.11 were made, and the fourth is the one offered

Every build so far has been published under the same version and the same
filename, with a different fingerprint:

| # | Fingerprint | Why it ran |
|---|---|---|
| 1 | `cb55b519…` | The original build |
| 2 | `550710bd…` | `app/**` added to the build trigger |
| 3 | `30a7f7e1…` | The docs commit `42f4eaa` also touched `CrushlyApp/` |
| 4 | `7df683a6…` | `680e05e` — the clip-sizing and credit fix |

The fourth build is the one every surface describes. It is 2,464 bytes larger than the third.

**One 1.0.11 build is missing from this list.** It ran alongside build 3 and
failed at the step that commits `release.json`; the reason was the release bot's
commit racing a human push to the same branch. `ci.yml` was green for it and no
artifact was published, so no member ever saw it. Recorded because a `skipped`
conclusion on the build list looks like a process fault long after the reason
has been forgotten.

**What the fingerprint-keyed cache bought.** The edge cache key carries the
published checksum, so each rebuild was served the moment it was published — no
stale body, no hand-fix, four times running. That fix has now earned itself on
every use it has had.

**What is still not covered.** The build job rewrites `release.json` and the
download page and commits them with the bot's token, which starts no workflows.
The APK surfaces follow automatically; the **web deploy** does not. Both build 3
and build 4 needed a production web deploy by hand after the fact for exactly
this reason — see below.

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
