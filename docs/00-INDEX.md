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

Version **1.0.10 (versionCode 10)** is committed on `app/space-tabs-and-playback`
at `535034a` and the media Worker is deployed and verified against production.
Video uploads no longer fail — the 415 came from the database's MIME map, not
from the client, and is fixed at four layers. The launcher icon is the official
Crushly heart again. Settings has a working **Check for updates** control and
shows the installed build. **Not yet proven:** a `.mov` recorded on a real phone
has never been published and played on a physical device, and the 1.0.10 APK
build was still compiling when these documents were written.

## Keeping this library current

These files are copied from the repository by hand after a release. When a
document changes in the repo, replace it here in the same sitting — a stale copy
that looks authoritative is worse than no copy at all. Each file records its own
version scope where that matters.
