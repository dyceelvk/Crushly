# Crushly Project — document library

**Official credit: Odoh chiagoziem isreal.**
Crushly is a product of Riel Inc.

This Drive folder is a **reading and sharing copy** of Crushly's documentation.
It is not the source of truth.

> **GitHub is the source of truth** — `github.com/dyceelvk/Crushly`.
> **Supabase is the live backend** — schema, auth, storage, member data.
> Neither Drive nor Dropbox replaces either of them. If a document here
> disagrees with the repo, the repo is right and this copy is stale.

---

## Start here

| If you want… | Read |
|---|---|
| to pick the project up cold | `PROJECT OVERVIEW/PROJECT_CONTINUITY.md` — the handover |
| to know what changed and why | `RELEASE NOTES/CHANGELOG.md`, then `RELEASE NOTES/RELEASE-1.0.10.md` |
| to work on uploads or playback | `TECHNICAL DOCUMENTATION/MEDIA-PIPELINE.md` |
| to work on the viewer UI | `FEATURE SPECIFICATIONS/POST-VIEWER-SPEC.md` and `UI DESIGN REFERENCES/UI-DESIGN-SYSTEM.md` |
| to touch the icon or ship a build | `RELEASE NOTES/ICON-AND-RELEASE.md` |
| to change schema or policies | `DATABASE DOCUMENTATION/DATABASE-AND-RLS.md` |
| to integrate with media | `API AND INTEGRATION DOCUMENTATION/API-MEDIA-WORKER.md` |
| to know what is broken | `BUG REPORTS AND FIXES/BUG-INDEX.md` |
| to know who is credited | `PROJECT OVERVIEW/CREDIT-AND-LICENCES.md` |

## Folders

| Folder | Contents |
|---|---|
| **PROJECT OVERVIEW** | handover document, README, security boundary, deployed state, credit and licences |
| **TECHNICAL DOCUMENTATION** | media pipeline end to end; APK size breakdown |
| **FEATURE SPECIFICATIONS** | the post viewer contract, including the composer rule |
| **UI DESIGN REFERENCES** | palette, type, screen inventory, signed-off copy and layout |
| **SCREENSHOTS AND MOCKUPS** | device captures — see the note in that folder |
| **BUG REPORTS AND FIXES** | one file per defect, plus the index of open ones |
| **DATABASE DOCUMENTATION** | schema, RLS, the media ticket gate, storage buckets |
| **API AND INTEGRATION DOCUMENTATION** | the media Worker's HTTP contract |
| **RELEASE NOTES** | changelog, per-release notes, icon and release engineering |
| **PROJECT ASSETS** | the official heart artwork at source resolution |

## The one-paragraph state of the project

Version **1.0.11 (versionCode 11)** is **built, published and live** at
`a656dbe` on `app/space-tabs-and-playback`. The APK is 92,994,875 bytes,
`550710bd…aa90e2f`; the Worker serves it at `/apk/latest` and advertises it at
`/version`; the download page quotes the same numbers; the release is
`android-test-1.0.11`. All three surfaces a phone consults agree with each
other, and the manifest inside the served APK reads back `1.0.11` / code `11`.

Video uploads no longer fail — the 415 came from the database's MIME map, not
from the client, and is fixed at four layers. The launcher icon is the official
Crushly heart, confirmed by extracting `res/sK.webp` from the APK that is
actually served. Settings has a working **Check for updates** control and shows
the installed build. Credit reads **Odoh chiagoziem isreal** in
Settings → About Crushly.

**1.0.11 carries four controls that used to lie:**

- **Save** writes a row. It used to flip a local flag, say "Post saved" and
  forget. There is now a `post_saves` table, three RPCs, a `SavedPosts` screen,
  a bookmark in the Flow header and a row in Settings — and it is private: no
  count, no notification, nobody but the owner can read it.
- **Circle posts have their counts.** `circle_feed` was the one function that
  built a post without merging `post_engagement`, so likes and comments came
  back blank inside every Circle.
- **Vibes keep their captions.** `Vibe.edit` was typed as the wrong shape, so
  the full-screen feed played every clip bare.
- **The Whisper keyboard no longer covers the composer on Android.**

All four are covered by new tests: `saves.sql`, `post_shape.sql`, and three
cases in `videoEdit.test.ts`.

**Where it is live.** Everywhere that matters: the production web build at
`mecrushly.vercel.app` serves a bundle containing `save_post` and `saved_posts`,
and `android-test-1.0.11` is the APK `/version` offers. There is no Play Store
listing; the APK is the distribution channel. `DEPLOYED.md` has the
measurements and the method.

**The release process was the actual risk, and it is fixed.** Three releases in
a row had to be finished by hand because the Worker never learned about the new
build: the Android job commits `release.json` with the bot's token, and GitHub
does not start workflows for a push made with that token, so `Deploy media
Worker` never ran. `/version` would keep advertising the previous build for
hours while a newer file sat on the release. The Android job now deploys the
Worker itself, then asks `/version` what it is offering and fails the release if
the answer is not the build it just published. The download page's baked-in
size and fingerprint are written from that APK by
`CrushlyApp/scripts/write-download-page.mjs` instead of by hand.

**Not yet proven:** a `.mov` recorded on a real iPhone or Samsung has never been
published and played back on a physical device. Everything else is proven over
HTTP against production and inside an Android 9 emulator; the camera-roll path
on hardware is the one open verification.

## Keeping this library current

These files are copied from the repository by hand after a release. When a
document changes in the repo, replace it here in the same sitting — a stale copy
that looks authoritative is worse than no copy at all. Each file records its own
version scope where that matters.
