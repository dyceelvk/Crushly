# Bug reports and fixes — index

**Official credit: Odoh chiagoziem isreal.**

Each file in this folder is one defect: what the member saw, what it actually
was, where it was fixed, and the evidence it is fixed. Written so that someone
who was not there can reproduce the reasoning rather than just trust the fix.

| File | Defect | Version fixed | Verified |
|---|---|---|---|
| `BUG-415-media-upload.md` | Video posts refused with "That file type is not supported." | 1.0.10 | Production over HTTP; **not on a physical phone** |

---

## Defects fixed in 1.0.10 and where the record lives

| Defect | Record |
|---|---|
| 415 on `.mov` clips | `BUG-415-media-upload.md` — this folder |
| Update announcer had no control, showed a stale version | `../RELEASE NOTES/` and `../PROJECT OVERVIEW/CHANGELOG.md` |
| Launcher icon was the C monogram, not the heart | `../RELEASE NOTES/ICON-AND-RELEASE.md` |
| Hourly upload ceiling could be walked past | `../DATABASE DOCUMENTATION/DATABASE-AND-RLS.md` §3 |

## Defects fixed in 1.0.9

| Defect | Cause |
|---|---|
| Every clip was filed as audio | `extensionFor('video/mp4')` returned `m4a` — the mp4 test sat inside the audio branch |
| Anything past ~25 MB died | the Worker buffered the whole body into an `ArrayBuffer` to measure it; it now streams and uses `Content-Length` |
| "new row violates row-level security policy" read as a blocked post | a failed Worker upload fell back to a Supabase Storage write with `upsert: true`, which RLS refuses |
| A bare gradient C appeared before the splash | `assets/splash-mark.png` was the C; now the CrushlyMark ribbon with real transparency |

## Defects fixed in 1.0.8

| Defect | Cause |
|---|---|
| Video posts could not be published at all | `media_insert_own` was missing; per-kind ceilings too small |
| Copy said "Find your connection" | replaced with "Create and discover your Crushes." |
| Splash flashed past | now held ~1.2 s |
| Update check invented a version code | it now reads the published `versionCode` out of the APK |

---

## Open defects

Tracked in `../PROJECT OVERVIEW/PROJECT_CONTINUITY.md` §7. The ones that
matter most:

- **No `.mov` from a real phone has been tested on a device.** The pipeline is
  proven over HTTP; hardware is not.
- `post_media`, so a post can carry more than one image.
- Comment invalidation after posting a comment.
- `setTool(null)` leaves a tool selected.
- `VibeFeed` reads a `vibe.edit` field that the feed does not send.
- `VibeAuthor.hasMoment` is always false from the feed.
- No seeded E2E account.

## How to write one of these

1. Symptom first, in the member's words.
2. What it was **not**, and why each guess was wrong — this is the most useful
   section and the one people skip.
3. The root cause, at the file and line that actually decided it.
4. The fix, layer by layer, with an explicit note on what was deliberately not
   changed.
5. Evidence: before and after measurements, not assertions.
6. What remains unproven.
