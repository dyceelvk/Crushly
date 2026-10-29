# Crushly 1.0.10 — release notes

**Released:** 2026-10-29
**Version:** 1.0.10 · versionCode **10** · iOS buildNumber 10
**Branch:** `app/space-tabs-and-playback`
**Commits:** `8ace805` (the fixes) · `535034a` (the rate-limit correction)
**Official credit:** Odoh chiagoziem isreal

---

## What changed for a member

**Video posting works.** If you picked a clip and got *"That file type is not
supported."*, that is fixed. Clips recorded on an iPhone or a Samsung — `.mov`,
which phones label `video/quicktime` — are now accepted. The app converts them
to MP4 on the device before uploading, so they play everywhere in the app.

**The icon is the Crushly heart.** The launcher tile, the round tile, the themed
(monochrome) icon and the browser favicon all show the heart. The C monogram
that used to appear on the launcher and in the browser tab is gone.

**Settings tells you the truth about updates.** There is a **Check for updates**
button. The App version row shows what you have installed and, when one is
offered, what you would move to (`1.0.9 → 1.0.10`). The footer names the build
number.

**Your credit is in the app.** Settings → About Crushly → Credits reads
**Odoh chiagoziem isreal**.

## What did not change

- `applicationId` is still `app.crushly`; the signing key is the same, so this
  installs **over** 1.0.9 and keeps your account and session.
- No change to auth, the database, or any existing feature. Photos, comments,
  likes and bookmarks behave exactly as before.
- Ceilings are unchanged: 80 MB for posts, messages, circles and vibes; 8 MB for
  photos and moments.

## Installing

1. Open `https://mecrushly.vercel.app/download`
2. Download the APK (~90 MB — use Wi-Fi).
3. Allow installing from an unknown source for your browser or file manager.
4. Install. It upgrades an existing 1.0.9 in place.
5. Check **Settings → About Crushly** reads 1.0.10.

If Android says `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, the installed copy is
signed with a different key: uninstall it, then install, then sign in again.

## Fixes, in detail

### 1. Video upload — 415 at the ticket, not at the client

`media_extension()` mapped MIME types to extensions and knew only `video/mp4`
and `video/webm`. `video/quicktime` mapped to `NULL`, and
`media_upload_ticket()` raised 415 before a byte was written. Fixed in four
layers:

1. `supabase/migrations/20261030000200_video_container_support.sql` —
   `video/quicktime → mov`, `video/x-m4v → mp4`, and the per-kind rules
   consolidated into one `media_kind_allows()`.
2. `createPost()` remuxes non-MP4/WebM clips to MP4 on the device — a stream
   copy, no encoder added to the APK.
3. The Worker unwraps `__CRUSHLY__…` markers instead of relaying them.
4. The Worker serves an explicit `Content-Type` per extension and
   `Accept-Ranges: bytes`, so clips seek and play instead of downloading.

### 2. Hourly upload ceiling

The ceiling counts **published** photos, moments, messages, posts, circle
messages and vibes — not reservations. A moment with no file books no
reservation, so a reservation-only count could be walked past. This was
rewritten mid-release and **reverted** when the smoke suite caught it.

### 3. Launcher icon

`assets/icon.png` — which feeds the legacy launcher icon *and* the favicon — was
still the C. Rebuilt from the project's own heart art at 62% of the canvas on
`#070708`; `foreground`, `background`, `monochrome` and `favicon` rebuilt the
same way. Verified through Expo prebuild at every density (48–192 px tiles,
108–432 px foregrounds). `android-icon-monochrome.png` was separately confirmed
to be the heart silhouette.

### 4. Update announcer

The row made one attempt at mount and sat behind a six-hour cache, with nothing
to press. Now: a real button, a re-fetch that invalidates the cache, an installed
→ offered version row, and the build number in the footer.

## Verification

| Check | Result |
|---|---|
| App unit tests | **118 pass / 0 fail** |
| Upload container tests | **8 pass / 0 fail** |
| Database suite (37 migrations applied twice, seed, comments, smoke) | **0 failures** |
| Ticket matrix in production | mp4 / webm / quicktime / x-m4v → **200** |
| Oversize in production | 90 MB post clip → **413** |
| Unsupported type in production | `application/octet-stream` → **415**, marker gone |
| `.mov` end to end | upload 201 → `create_post` 200 → `GET` 200 `video/quicktime`, `accept-ranges: bytes` |
| `.mp4` end to end | upload → post → `GET` 200 `video/mp4`, `accept-ranges: bytes` |
| Worker deployed | `deploy-worker.yml` success on `535034a`, and again on the release commit |
| Typecheck | `tsc --noEmit` exit 0 |
| Icon densities | 5 tile + 5 foreground densities emitted, art 62–63% of tile |
| Icon in the shipped APK | `res/sK.webp` extracted from the served file and inspected — the heart |
| APK served == APK published | sha256 of `/apk/latest` matches the release asset exactly |
| Android 9 emulator | cold start and relaunch passed |
| Branch CI | `8681320`, success |

## The build is out

| | |
|---|---|
| Release | `android-test-1.0.10` — published 2026-10-29 20:15 UTC |
| APK | `Crushly-1.0.10-Android9plus.apk` · **92,987,427** bytes |
| SHA-256 | `0f123f02774e51b0b5ea12ec748d59467d4faab51d9b36f6184a0adda7dc37ff` |
| `/version` | reports 1.0.10 / versionCode 10 / 92,987,427 bytes |
| `/apk/latest` | serves the same file, `206` on a range request |
| Download page | names 1.0.10 and quotes the same size and hash |

The emulator job also passed: install compatibility, cold start, relaunch, and
the packaged-APK secret audit.

### Two things needed a hand to close

Neither was automatic, and both would have left the release looking done while
one surface disagreed with another:

1. **The Worker kept advertising 1.0.9.** The Android job commits `release.json`
   with the release bot's token, and a push made with that token does not
   trigger workflows, so `deploy-worker.yml` never ran for the version bump. The
   deploy was dispatched manually. *A `release.json` commit is not a deployment.*
2. **The download page quoted 1.0.9's numbers** under the 1.0.10 filename — its
   own integrity check would have contradicted the download. Corrected in
   `aac4084` from values measured off `/apk/latest`.

## Not proven — read this before calling the release finished

- **No `.mov` from a real iPhone or Samsung has been published and played back
  on a physical device.** Everything above is proven over HTTP against
  production, plus a real MP4 end to end and the Android 9 emulator pass. The
  camera-roll path on hardware is the one remaining test, and it is the exact
  thing a member complained about.
- The launcher icon was verified by extracting `res/sK.webp` from the served
  APK and inspecting it — that proves the pixels shipped. It does not show what
  a particular launcher's mask does to them on a particular phone.

## Known open defects (not in this release)

`Chat.tsx` keyboard avoidance · `post_media` counts · `circle_feed` engagement ·
comment invalidation after posting · `setTool(null)` · `VibeFeed`'s `vibe.edit`
field · `VibeAuthor.hasMoment` from the feed · no seeded E2E account.

## Credit

**Odoh chiagoziem isreal.** Crushly is a product of Riel Inc.
