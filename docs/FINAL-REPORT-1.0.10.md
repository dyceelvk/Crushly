# Crushly 1.0.10 — delivery report

**Official credit: Odoh chiagoziem isreal.** Crushly is a product of Riel Inc.
Report written 2026-10-29 20:36 UTC. Every number here was fetched from the
running system.

---

## A. VIDEO UPLOAD

### Fixed at the source

The `415 That file type is not supported.` came from **Postgres**, not the
client. `media_upload_ticket()` is the only gate between a chosen clip and
storage, and it resolved MIME types through `media_extension()`, which knew
`video/mp4` and `video/webm` and nothing else. `video/quicktime` — what an
iPhone and a Samsung gallery both send for `.mov` — matched no branch, returned
`NULL`, and the function raised 415 before a byte left the device.

**Four fixes, one per layer. None hides an error or weakens a policy.**

| Layer | File | Change |
|---|---|---|
| Database accepts the container | `supabase/migrations/20261030000200_video_container_support.sql` | `video/quicktime → mov`, `video/x-m4v → mp4`; per-kind rules consolidated into one `media_kind_allows()`. **Ceilings, rate limit and path booking untouched.** |
| Client converts first | `src/lib/nativeTrim.ts`, `src/api/service.ts` | `createPost()` remuxes non-MP4/WebM clips to MP4 on the device — stream copy, no re-encode, **no encoder added to the APK** |
| Worker stops leaking internals | `cloudflare/media-worker/src/index.ts` | unwraps `__CRUSHLY__<status>__<code>__<message>` into a real status and a plain sentence |
| Worker serves a real type | same | explicit `Content-Type` from the extension + `Accept-Ranges: bytes`, so clips seek and play instead of downloading |

### Proven against production, over HTTP

| Type | Result |
|---|---|
| `video/mp4` | 200 → `mp4` |
| `video/webm` | 200 → `webm` |
| `video/quicktime` | **200 → `mov`** |
| `video/x-m4v` | 200 → `mp4` |
| `application/octet-stream` | 415 `{"error":"That file type is not supported."}` — **marker gone** |
| 90 MB post clip | 413 `{"error":"That file is too large to send."}` |

End to end: `.mov` uploaded (201) → attached via `create_post` (200) → served
`200 video/quicktime, accept-ranges: bytes`. `.mp4` the same, `video/mp4`.

**Tests:** app **118 pass / 0 fail**, upload container tests **8 / 0**, database
suite (37 migrations applied twice + seed + comments + smoke) **0 failures**,
`tsc --noEmit` exit 0, branch CI success on `7b866ed`.

### Errors a member now reads

Unsupported type · wrong kind for the slot · over the ceiling · hourly limit ·
empty file · network failure — each a plain sentence with a real HTTP status.

### Not proven

**No `.mov` recorded on a real iPhone or Samsung has been published and played
back on a physical device.** The ticket, upload and serve layers are all proven
over HTTP against production, plus a real MP4 end to end and an Android 9
emulator pass. The camera-roll path on hardware is the one open test — and it is
exactly what the member complained about.

---

## B. ANDROID ICON

**It is the official Crushly heart, and it is now in the shipped APK.**

The C monogram was not a stray file — `assets/icon.png` fed both the legacy
`ic_launcher` and the favicon, so it was the file most devices actually rendered.

| Asset | Now |
|---|---|
| `icon.png` | official heart, 62% of canvas on `#070708` |
| `android-icon-foreground.png` | heart on transparent, safe-circle margins |
| `android-icon-background.png` | `#070708` |
| `android-icon-monochrome.png` | heart silhouette (Android 13+ themed icons) |
| `favicon.png` | same mark |

Source was `/tmp/orig/android-icon-foreground.png` from commit `c042b0f` — its
own alpha channel. Thresholding `icon.png` was tried first and **produced a grey
glow halo**; that path is abandoned and recorded.

**Verified three ways:**
1. `npx expo prebuild` emitted `ic_launcher.webp` at 48/72/96/144/192 and
   `ic_launcher_foreground.webp` at 108/162/216/324/432, art measuring 62–63% of
   each tile.
2. `android-icon-monochrome.png`'s alpha channel rendered as ASCII — the heart.
3. **`res/sK.webp` extracted from the APK being served** and inspected visually:
   the gold-to-pink heart ribbon on near-black.

`applicationId` unchanged (`app.crushly`), signing key unchanged, so 1.0.10
upgrades 1.0.9 in place. `versionCode` 10, `app.json` carries the adaptive block
explicitly so EAS/CI cannot fall back to Expo's default mark.

**Install:** open `mecrushly.vercel.app/download` → download ~93 MB over Wi-Fi →
allow install from unknown source → install (upgrades 1.0.9 in place) → confirm
**Settings → About Crushly** reads 1.0.10 and Credits names Odoh chiagoziem
isreal.

---

## C. GOOGLE DRIVE

**Access was genuinely available; the library is built.**

| | |
|---|---|
| Folder | **Crushly Project** |
| ID | `1CODwtatUX48pRHX2MmJX71WPY3ygSydD` |
| Contents | 10 folders, **19 documents**, 3 source assets — verified by listing |

```
Crushly Project/
├── 00-INDEX.md                     start here; folder map + current state
├── PROJECT OVERVIEW/               PROJECT_CONTINUITY, README, SECURITY,
│                                   DEPLOYED, CREDIT-AND-LICENCES
├── TECHNICAL DOCUMENTATION/        MEDIA-PIPELINE, APK-SIZE
├── FEATURE SPECIFICATIONS/         POST-VIEWER-SPEC
├── UI DESIGN REFERENCES/           UI-DESIGN-SYSTEM
├── SCREENSHOTS AND MOCKUPS/        SCREENSHOTS-STATUS (honest: none yet)
├── BUG REPORTS AND FIXES/          BUG-415-media-upload, BUG-INDEX
├── DATABASE DOCUMENTATION/         DATABASE-AND-RLS
├── API AND INTEGRATION DOC/        API-MEDIA-WORKER
├── RELEASE NOTES/                  CHANGELOG, RELEASE-1.0.10, ICON-AND-RELEASE
└── PROJECT ASSETS/                 icon, foreground, monochrome at 1024²
```

`PROJECT_CONTINUITY.md` is written: 10 sections — what the project is, credit,
repo map, media pipeline, update announcer, release checklist, known issues,
database, continuation notes, next steps.

**Drive does not replace GitHub or Supabase.** `00-INDEX.md` says so in its first
paragraph.

---

## D. DROPBOX

**Read/write verified, then used. Two backups, both round-trip proven.**

Account Dycee Lvk `dbid:AAASHymyow7GD5rExiuLcPW74AL_znQDkTA`, Basic, 2 GB.

```
Crushly/
├── PROJECT_DOCUMENTATION/     11 documents
├── SOURCE_BACKUPS/CURRENT_STABLE/
│   └── Crushly-1.0.10-SOURCE.zip   19,284,361 bytes
├── RELEASE_ARTIFACTS/         (empty, deliberately)
├── CHANGELOG.md
├── PROJECT_CONTINUITY.md
└── BACKUP-LOG.md              what, where, when, which commit, how to restore
```

**Backup 2** (the released build): 19,284,361 bytes, commit `80152d2`, 348
tracked files, SHA-256 `8f9f1330…3170a5d8`. Built from `git ls-files` — excludes
`node_modules` (620 MB), `dist`, `.expo`, `.cxx`, caches and every
keystore/`.env`/`.git` path. Scanned for service-role keys, database URLs,
deployment tokens and private-key headers: no matches. `SNAPSHOT.txt` inside the
archive records commit, timestamp and credit, so it is self-describing.

**Verified by downloading it back and re-hashing: byte-identical**, `unzip -t`
clean, `app.json` intact at 1.0.10 / versionCode 10 / `app.crushly`.

**Deliberately not backed up:** the APK (reproducible, already a GitHub Release
asset with a published SHA-256, 93 MB in a 2 GB quota buys nothing), database
dumps (schema reconstructible from 37 migrations; member data is not ours to
copy), and any secret.

---

## E. GITHUB

**`github.com/dyceelvk/Crushly` remains the single source of truth.**

Branch `app/space-tabs-and-playback` @ **`7b866ed`**, working tree clean, CI
green, upstream in sync.

| Commit | What |
|---|---|
| `7b866ed` | state the release as it is |
| `8681320` | backup log for the released build |
| `80152d2` | 1.0.10 is live + the two manual steps |
| `aac4084` | download page → the build actually served |
| `9660a2b` | Worker offers 1.0.10 |
| `535034a` | rate limit counts what was published |
| `8ace805` | MOV clips, heart icon, update button |

The full document library is now **in the repo** at `docs/` (14 files) as well
as in Drive and Dropbox. GitHub is canonical; the clouds are reading copies.

### Steps that needed a human, recorded rather than glossed

1. **The Worker did not auto-deploy.** The Android job commits `release.json`
   with the release bot's token, and a push made with that token does not trigger
   workflows — so `/version` kept advertising 1.0.9 for a published 1.0.10 until
   `deploy-worker.yml` was dispatched by hand. *A `release.json` commit is not a
   deployment.*
2. **The download page quoted 1.0.9's size and hash** under the 1.0.10
   filename, so its own integrity check would have contradicted the download.
   Corrected from values measured off `/apk/latest`.
3. **`deploy-web.yml` is still red** on every push — steps 1–6 pass, so the cause
   is the missing `VERCEL_TOKEN` secret, not the build. Production was deployed
   through Vercel's Git integration instead. **Manual action needed:** add the
   secret, or delete the step, so a red check stops meaning nothing.

### Other manual actions outstanding

- **`VERCEL_TOKEN`** — as above.
- Watching a real `.mov` land from a phone.

---

## F. REMAINING WORK

### The one that matters

**Post a real `.mov` from an iPhone or Samsung gallery and confirm it publishes
and plays on that device.** Everything else about the 415 is proven; this is the
member's own path and it is untested. Until it passes, the bug is fixed in the
pipeline and unconfirmed in the hand.

### Known, unfixed, in priority order

| # | Issue | Note |
|---|---|---|
| 1 | **Bookmark on the viewer is decorative** | `toggleSave` flips local state and toasts "Post saved"; no request, no table. The rail order is signed off, so this needs a `post_saves` table + RLS + RPC, or an agreed decision to remove the control. |
| 2 | `Chat.tsx` keyboard covers the composer | thread screen only |
| 3 | Multi-image posts need a `post_media` table | one attachment per post today |
| 4 | `circle_feed` returns no engagement | |
| 5 | Comment hooks never invalidate `keys.post(id)` | counts go stale after commenting |
| 6 | `setTool(null)` overwrites `initialTool` | |
| 7 | `VibeFeed` ignores `vibe.edit`; `VibeAuthor` has no `hasMoment` | |
| 8 | No persistent E2E seed account | browser tests depend on a throwaway signup |
| 9 | APK is ~93 MB | per-ABI split would roughly halve the download |

### Proven vs. unproven, plainly

**Proven:** the database accepts and stores `.mov`; the Worker serves it with the
right type and ranges; a clip publishes, appears in the feed and survives a
fresh read; the APK contains the heart at every density; the Worker advertises
1.0.10; the download page and the served file agree to the byte; the emulator
cold-starts and relaunches; credit reads `Odoh chiagoziem isreal` in the app,
the repo, Drive and Dropbox.

**Unproven:** a real phone's camera roll; what a specific launcher mask does to
the icon; and the post viewer has never been photographed on a device — it was
verified by reading the screen tree, not by tapping through it. Every visual
claim in this delivery is **code-level verified, device-level unverified.**
