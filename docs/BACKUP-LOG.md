# Crushly — backup log

**Official credit: Odoh chiagoziem isreal.**

Every entry below was written by an upload that returned a real Dropbox
metadata record. Sizes are the byte counts Dropbox stored, not estimates.

Account: Dycee Lvk &lt;dyceelvk@gmail.com&gt; · `dbid:AAASHymyow7GD5rExiuLcPW74AL_znQDkTA`
Plan: Dropbox Basic, 2 GB. Usage at backup time: 216,965,962 bytes of 2,147,483,648.

---

## Backup 2 — 2026-10-29 20:32 UTC (the released build)

Taken after 1.0.10 was **built, published and verified live**, so this snapshot
is the one that matches what phones can actually install.

### Source snapshot — `CURRENT_STABLE`

| | |
|---|---|
| Path | `/Crushly/SOURCE_BACKUPS/CURRENT_STABLE/Crushly-1.0.10-SOURCE.zip` |
| Bytes | **19,284,361** |
| Dropbox rev | `0165f0093fcdac400000002c3178703` |
| SHA-256 (local) | `8f9f1330b05829bdb1593684922b99b3c464e424bbbee5eff6c25cb23170a5d8` |
| Commit | **`80152d2`**, branch `app/space-tabs-and-playback` |
| Files | 348 tracked |

- Built from `git ls-files`, so only tracked source is inside.
- Excludes `node_modules` (620 MB), `.expo`, `dist`, `android/app/.cxx` build
  output, logs, caches and every `.env*`/keystore/`.git` path.
- `SNAPSHOT.txt` at the archive root records the commit, the timestamp and the
  credit, so the archive is self-describing if it is ever separated from this log.
- Scanned for service-role keys, database URLs, deployment tokens and private-key
  headers across all tracked files: no matches.

### Documents

| Path | Bytes | Rev |
|---|---:|---|
| `/Crushly/PROJECT_CONTINUITY.md` | 12,459 | `0165f0092f86e1100000002c3178703` |
| `/Crushly/CHANGELOG.md` | 9,510 | `0165f0093343b7b0000002c3178703` |
| `/Crushly/PROJECT_DOCUMENTATION/DEPLOYED.md` | 6,791 | `0165f0092bef27300000002c3178703` |

`DEPLOYED.md` was replaced with the verified 1.0.10 numbers — 92,987,427 bytes
and `0f123f02…d7dc37ff`, measured by downloading `/apk/latest`.

---

## Backup 1 — 2026-10-29 20:06 UTC (pre-release)

Superseded by Backup 2. Kept in the log because it records what the tree looked
like **before** the release closed.

- Archive: 19,247,111 bytes,
  SHA-256 `153e7e076980231e850ad0975f578530ec85d252510fac8a3f010f194a8f6fcc`,
  commit `535034a`, 334 files.
- Verified by downloading it back from Dropbox and re-hashing: identical, and
  `unzip -t` reported no errors.
- Documents: `PROJECT_CONTINUITY.md` 9,704 · `CHANGELOG.md` 7,147 ·
  `README.md` 27,154 · `SECURITY.md` 4,107 · `DEPLOYED.md` 6,026 ·
  `APK-SIZE.md` 3,530 · `MEDIA-PIPELINE.md` 6,022 · `POST-VIEWER-SPEC.md` 3,654 ·
  `ICON-AND-RELEASE.md` 6,978 · `DATABASE-AND-RLS.md` 5,570 ·
  `CREDIT-AND-LICENCES.md` 3,177.

### Structure created in Backup 1

```
Crushly/
├── PROJECT_DOCUMENTATION/
├── SOURCE_BACKUPS/
│   └── CURRENT_STABLE/
├── RELEASE_ARTIFACTS/
├── CHANGELOG.md
├── PROJECT_CONTINUITY.md
└── BACKUP-LOG.md
```

### Not backed up, deliberately

- **The APK.** ~93 MB, reproducible from source, and already a GitHub Release
  asset with a published SHA-256 (`android-test-1.0.10`). A third copy in a 2 GB
  consumer Dropbox buys nothing. `RELEASE_ARTIFACTS/` exists and is empty if a
  copy is ever wanted.
- **Database dumps.** The schema is reconstructible from
  `supabase/migrations/` (37 files, applied twice by CI to prove idempotence).
  Member data is not ours to copy into Dropbox.
- **Secrets.** Nothing from GitHub Secrets, `.env` files or the Supabase
  service-role key is present anywhere in this tree.

---

## How to restore from this backup

```bash
unzip Crushly-1.0.10-SOURCE.zip          # -> Crushly-1.0.10/
cat Crushly-1.0.10/SNAPSHOT.txt          # which commit this is
cd Crushly-1.0.10 && git init && git add -A
# then compare against a real clone of github.com/dyceelvk/Crushly
#   — do not force-push over newer work
cd CrushlyApp && npm ci && npm test
```

The archive is source only. It will not build without `npm ci`, and it
deliberately carries no credential — supply `EXPO_PUBLIC_SUPABASE_URL` and
`EXPO_PUBLIC_SUPABASE_ANON_KEY` the same way CI does.

**GitHub remains the source of truth.** This backup exists for the case where
GitHub is unreachable or a branch is destroyed. Never restore *from* here into a
repo that has newer commits.

---

## Next backup

Take one when the version changes or a merge lands that changes schema or the
media pipeline. Name it `Crushly-<version>-SOURCE.zip`, keep it in
`CURRENT_STABLE/`, and **move the previous one into
`SOURCE_BACKUPS/ARCHIVE-<version>/`** rather than deleting it —
`CURRENT_STABLE` should hold exactly one archive.
