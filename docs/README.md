# Crushly documentation

**Official credit: Odoh chiagoziem isreal.**

This folder is the canonical, versioned home of Crushly's documentation. Copies
of these files live in Google Drive and Dropbox for reading and sharing, but
**this is the copy that counts** — it moves with the code, it is reviewed in the
same commits, and it is what `git log` can prove.

> GitHub is the source of truth. Supabase is the live backend. Drive and Dropbox
> are copies of documents and a source archive — neither replaces either.

## Read in this order

| Order | File | Why |
|---:|---|---|
| 1 | [`00-INDEX.md`](00-INDEX.md) | what exists and which file answers your question |
| 2 | [`../PROJECT_CONTINUITY.md`](../PROJECT_CONTINUITY.md) | the handover: state, repo map, next steps |
| 3 | [`../CHANGELOG.md`](../CHANGELOG.md) | what changed, and the root cause behind each change |
| 4 | [`RELEASE-1.0.10.md`](RELEASE-1.0.10.md) | the current release, including what is *not* proven |

## Reference

| Area | File |
|---|---|
| Media pipeline (upload → storage → feed → playback) | [`MEDIA-PIPELINE.md`](MEDIA-PIPELINE.md) |
| Media Worker HTTP contract | [`API-MEDIA-WORKER.md`](API-MEDIA-WORKER.md) |
| Schema, RLS, the media ticket gate | [`DATABASE-AND-RLS.md`](DATABASE-AND-RLS.md) |
| Post viewer and the composer rule | [`POST-VIEWER-SPEC.md`](POST-VIEWER-SPEC.md) |
| Palette, type, screen inventory, copy rules | [`UI-DESIGN-SYSTEM.md`](UI-DESIGN-SYSTEM.md) |
| Launcher icon, versioning, building and installing | [`ICON-AND-RELEASE.md`](ICON-AND-RELEASE.md) |
| Why the APK is 90 MB | [`../APK-SIZE.md`](../APK-SIZE.md) |
| Security boundary | [`../SECURITY.md`](../SECURITY.md) |
| Credit and third-party licences | [`CREDIT-AND-LICENCES.md`](CREDIT-AND-LICENCES.md) |

## Defects

| File | Contents |
|---|---|
| [`BUG-INDEX.md`](BUG-INDEX.md) | every fixed defect by version, plus the open ones |
| [`BUG-415-media-upload.md`](BUG-415-media-upload.md) | the video upload blocker, in full |

## Cloud copies

| File | Contents |
|---|---|
| [`BACKUP-LOG.md`](BACKUP-LOG.md) | exactly what was backed up, where, when, at which commit, and how to restore |
| [`SCREENSHOTS-STATUS.md`](SCREENSHOTS-STATUS.md) | why there are no device screenshots, and which capture to take first |

## House rules for these documents

1. **Never claim a thing is verified when it was not.** A test that did not run
   is not a pass. Where something was checked by reading code rather than by
   running it, the document says so.
2. **Record what was *not* changed** whenever a fix touches a boundary — signing
   keys, `applicationId`, RLS policies, ceilings. That is how a future reader
   knows the change was scoped.
3. **Record the dead ends.** The icon glow halo from thresholding `icon.png`,
   the rate-limit predicate that had to be reverted — those belong in the record
   so they are not attempted again.
4. **Update this folder and the Drive/Dropbox copies together.** A stale copy
   that looks authoritative is worse than none.
