# Crushly media Worker

The only thing that can read or write the media bucket.

## Why this exists

Photos used to sit in a **public** Supabase Storage bucket: anyone holding a
link could fetch any chat photo, forever, even after the message itself was
gone. Media now lives in a **private Backblaze B2 bucket** that nothing can
reach except this Worker, which:

1. takes the member's Supabase access token,
2. asks the database — `can_view_media`, `can_manage_media`,
   `media_upload_ticket` — whether that member may see or remove the file,
3. and only then fetches from (or writes to) B2.

The Worker decides nothing about permissions itself, so blocks, connections,
profile visibility and Moment expiry keep exactly the meaning they already have
in `supabase/migrations/`.

## One-time setup (all from a phone browser, no computer)

### 1. Backblaze (holds the files — 10 GB free, no card)

1. Create an account: <https://www.backblaze.com/sign-up/b2-cloud-storage-backup-archive>
2. **Buckets → Create a bucket**: name it `crushly-media`, set it to
   **Private**, region **EU Central** (shortest hop from West Africa).
3. **Buckets → Lifecycle Settings** on that bucket → *Use custom lifecycle
   rules*:
   - File path prefix: `moments/`
   - Days from uploading to hiding: **1**
   - Days from hiding to deleting: **1**

   That is what makes "Moments disappear after 24 hours" true at the storage
   level — the photo is gone even if every job failed.
4. **App Keys → Add a New Application Key**: allow access to `crushly-media`
   only, with read **and** write. Copy the **keyID** and the **applicationKey**
   — the key is shown once.

### 2. Cloudflare (serves the files — free plan, no card)

1. Create an account: <https://dash.cloudflare.com/sign-up>
2. **My Profile → API Tokens → Create Custom Token**: Permission
   *Account → Workers Scripts → Edit*.
3. Copy your **Account ID** — it is in the right-hand column of any Workers &
   Pages page.

### 3. GitHub (where the Worker gets its secrets)

GitHub → **Settings → Secrets and variables → Actions**. Never paste these into
chat, a commit, or an issue.

| Type | Name | Value |
|---|---|---|
| Secret | `CLOUDFLARE_API_TOKEN` | the token from step 2 |
| Secret | `B2_KEY_ID` | Backblaze application keyID |
| Secret | `B2_APPLICATION_KEY` | Backblaze applicationKey |
| Secret | `B2_BUCKET` | `crushly-media` |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are reused from the existing
`EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` secrets — nothing
new to add.

### 4. Point the app at it

In the app build environment (GitHub secret for the APK, Netlify env var for the
web):

```
EXPO_PUBLIC_MEDIA_BASE_URL=https://crushly-media.<your-subdomain>.workers.dev
```

Leave it empty and the app keeps using Supabase Storage exactly as before. The
Worker URL is printed by the deploy job's output.

## Deploying

`.github/workflows/deploy-worker.yml` deploys on every push that touches
`cloudflare/**`, or from **Actions → Deploy media Worker → Run workflow**. Until
the secrets exist it prints a warning and stops — it never fails the branch.

Manual check (needs a computer): `npx wrangler deploy --dry-run` in this folder.

## Endpoints

| Method | Path | What it does |
|---|---|---|
| `POST` | `/m` | Upload. `X-Media-Kind: photos\|moments\|messages`; body is the file. The database mints the path, returns `{ path, url }`. |
| `GET` | `/m/<path>` | Serves the file if the database says the member may see it. Cached only when every member would get the same bytes. |
| `DELETE` | `/m/<path>` | Removes the file if the database says it is theirs. |
| `GET` | `/health` | `{"ok":true}` |

All except `/health` require a Supabase access token in `Authorization:
Bearer …` (or, for players that cannot set headers, `?token=`).

## If this ever has to be undone

Unset `EXPO_PUBLIC_MEDIA_BASE_URL` and rebuild. Files already uploaded keep
their URLs in the database rows, so they carry on working; only new uploads go
back to Supabase Storage.
