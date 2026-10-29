# Crushly — backup log

**Official credit: Odoh chiagoziem isreal.**

Every entry below was written by an upload that returned a real Dropbox
metadata record. Sizes are the byte counts Dropbox stored, not estimates.

Account: Dycee Lvk &lt;dyceelvk@gmail.com&gt; · `dbid:AAASHymyow7GD5rExiuLcPW74AL_znQDkTA`
Plan: Dropbox Basic, 2 GB. Usage at backup time: 216,965,962 bytes of 2,147,483,648.

---

## Backup 1 — 2026-10-29 20:06 UTC

**Target:** `/Crushly` (created this run; root did not previously contain it)

### Structure created

```
Crushly/
├── PROJECT_DOCUMENTATION/
├── SOURCE_BACKUPS/
│   └── CURRENT_STABLE/
├── RELEASE_ARTIFACTS/
├── CHANGELOG.md
├── PROJECT_CONTINUITY.md
└── BACKUP-LOG.md            (this file)
```

### Source snapshot

| Path | Bytes | Dropbox rev | SHA-256 (local) |
|---|---:|---|---|
| `/Crushly/SOURCE_BACKUPS/CURRENT_STABLE/Crushly-1.0.10-SOURCE.zip` | 19,247,111 | `0165f0036b4ab2300000002c3178703` | `153e7e076980231e850ad0975f578530ec85d252510fac8a3f010f194a8f6fcc` |

- Taken from git commit **`535034a`**, branch `app/space-tabs-and-playback`.
- Built from `git ls-files`, so **only tracked source** is inside: 334 files.
- Excludes `node_modules` (620 MB), `.expo`, `dist`, `android/app/.cxx` build
  output, logs, caches, and every `.env*`/keystore/`.git` path.
- Scanned for service-role keys, database URLs, deployment tokens
  and private-key headers across all tracked files: **no matches**.
- Dropbox's own `content_hash` is recorded on the server side; the SHA-256 above
  is the local artefact checksum for comparison after a re-download.

### Documents

| Path | Bytes |
|---|---:|
| `/Crushly/PROJECT_CONTINUITY.md` | 9,704 |
| `/Crushly/CHANGELOG.md` | 7,147 |
| `/Crushly/PROJECT_DOCUMENTATION/README.md` | 27,154 |
| `/Crushly/PROJECT_DOCUMENTATION/SECURITY.md` | 4,107 |
| `/Crushly/PROJECT_DOCUMENTATION/DEPLOYED.md` | 6,026 |
| `/Crushly/PROJECT_DOCUMENTATION/APK-SIZE.md` | 3,530 |
| `/Crushly/PROJECT_DOCUMENTATION/MEDIA-PIPELINE.md` | 6,022 |
| `/Crushly/PROJECT_DOCUMENTATION/POST-VIEWER-SPEC.md` | 3,654 |
| `/Crushly/PROJECT_DOCUMENTATION/ICON-AND-RELEASE.md` | 6,978 |
| `/Crushly/PROJECT_DOCUMENTATION/DATABASE-AND-RLS.md` | 5,570 |
| `/Crushly/PROJECT_DOCUMENTATION/CREDIT-AND-LICENCES.md` | 3,177 |

Total written this backup: **19,331,180 bytes** of source archive plus
**76,069 bytes** of documentation.

### Not backed up, deliberately

- **The APK.** It is ~90 MB, it is a build artefact reproducible from source,
  and it already exists as a GitHub Release asset with a published SHA-256. A
  third copy in a 2 GB consumer Dropbox buys nothing. If a Dropbox copy is
  wanted, put it in `RELEASE_ARTIFACTS/` — the folder exists and is empty.
- **Database dumps.** The schema is fully reconstructible from
  `supabase/migrations/` (37 files, applied twice by CI to prove idempotence).
  Member data is not ours to copy into Dropbox.
- **Secrets.** Nothing from GitHub Secrets, `.env` files or the Supabase service
  role key is present anywhere in this tree.

---

## How to restore from this backup

```bash
unzip Crushly-1.0.10-SOURCE.zip          # -> Crushly-1.0.10/
cd Crushly-1.0.10 && git init && git add -A
# then, from a real clone of github.com/dyceelvk/Crushly:
#   compare against origin, do not force-push over newer work
cd CrushlyApp && npm ci && npm test
```

The archive is source only. It will not build without `npm ci`, and it
deliberately does not carry any credential — supply `EXPO_PUBLIC_SUPABASE_URL`
and `EXPO_PUBLIC_SUPABASE_ANON_KEY` the same way CI does.

**GitHub remains the source of truth.** This backup exists in case GitHub is
unreachable or a branch is destroyed. Never restore *from* here into a repo that
has newer commits.

---

## Next scheduled backup

Take a new one when the version changes, or when a branch merge lands that
changes schema or the media pipeline. Name the archive
`Crushly-<version>-SOURCE.zip`, keep it in `CURRENT_STABLE/`, and **move the
previous one into `SOURCE_BACKUPS/ARCHIVE-<version>/`** rather than deleting it —
`CURRENT_STABLE` should hold exactly one archive.
