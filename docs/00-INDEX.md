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

Version **1.0.10 (versionCode 10)** is **built, published and live** at
`8681320` on `app/space-tabs-and-playback`. The APK is 92,987,427 bytes,
`0f123f02…d7dc37ff`; the Worker advertises it at `/version`; the download page
quotes the same numbers; the release is `android-test-1.0.10`. All three surfaces
a phone consults agree with each other.

Video uploads no longer fail — the 415 came from the database's MIME map, not
from the client, and is fixed at four layers. The launcher icon is the official
Crushly heart, confirmed by extracting `res/sK.webp` from the APK that is
actually served. Settings has a working **Check for updates** control and shows
the installed build. Credit reads **Odoh chiagoziem isreal** in
Settings → About Crushly.

**Not yet proven:** a `.mov` recorded on a real iPhone or Samsung has never been
published and played back on a physical device. Everything is proven over HTTP
against production and inside the emulator; the camera-roll path on hardware is
the one open verification.

## Keeping this library current

These files are copied from the repository by hand after a release. When a
document changes in the repo, replace it here in the same sitting — a stale copy
that looks authoritative is worse than no copy at all. Each file records its own
version scope where that matters.
