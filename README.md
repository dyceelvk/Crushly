# Crushly

A premium dating and social app for gay, bi and queer men. *Meet men. Make connections. Follow the feeling.*

**Crushly is a product of Riel Inc.**

| Folder | What it is |
| --- | --- |
| [`CrushlyApp/`](CrushlyApp/) | The app. Expo (React Native) for iOS, Android and web, written in TypeScript. |
| [`supabase/`](supabase/) | The backend. Supabase: Postgres schema + row-level security, RPC functions, Auth, Storage and an optional demo seed. |
| [`netlify.toml`](netlify.toml) | Web deployment: builds the Expo web export on Netlify. |

There is no server to run — the app talks to Supabase directly.

## Run it locally

Requires **Node 22+**, [Docker](https://docs.docker.com/) and the
[Supabase CLI](https://supabase.com/docs/guides/local-development).

```bash
# 1. Backend: local Supabase stack (port 54321)
supabase start
supabase db reset                 # schema + optional demo community (seed.sql)
cd supabase && npm install
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_SERVICE_ROLE_KEY=<from `supabase status`> \
npm run seed:photos               # demo portraits into Storage (skip for a clean stack)
cd ..

# 2. App
cd CrushlyApp
npm install
cp .env.example .env              # then paste the URL + anon key from `supabase status`
npm start                         # Expo dev server: press i / a, or scan the QR code with Expo Go
```

The web app also runs from the same dev server (`npm run web`).

### Optional: the demo community

`seed.sql` fills a **local** stack with fictional members (password `crushly123`
for all) so you can click around without juggling two accounts — for example
sign in as **daniel@crushly.app** and crush back **Marcus** to see a Mutual
Crush. It stays out of the product: the sign-in screen's *Explore the demo
community* button only appears when you set `EXPO_PUBLIC_DEMO_LOGIN=1`, and
every seeded member is flagged `is_demo`. If demo data ever reaches a live
project, purge it so only real members remain:

```bash
cd supabase && npm run admin -- purge-demo --dry-run   # preview
cd supabase && npm run admin -- purge-demo             # delete demo members + photos
```

## Deploy for real (Netlify + Supabase)

A productive deployment has real accounts and no seeded data. Four steps from
zero:

1. **Create the backend.** New project at [supabase.com](https://supabase.com),
   then create the schema — easiest first:
   - **GitHub Actions (recommended)**: add one repository secret and the
     [`db-migrations.yml`](.github/workflows/db-migrations.yml) workflow pushes
     `supabase/migrations/` to your project automatically on every migration
     change (or manually from the Actions tab → *Run workflow*):
     1. In your Supabase project, click **Connect** at the top of the page →
        **Session pooler** → copy the URI. Replace `[YOUR-PASSWORD]` with
        your database password (Settings → Database → *Reset database
        password* if you lost it; percent-encode special characters).
     2. GitHub repo → **Settings → Secrets and variables → Actions** →
        **New repository secret** → name it `SUPABASE_DB_URL`, paste the URI.
     Never commit that value or paste it into chat.
   - **No CLI, one time**: run the three parts in [`supabase/setup/`](supabase/setup/)
     in the project's **SQL editor** (each file on GitHub has a copy button),
     or paste the all-in-one [`supabase/setup.sql`](supabase/setup.sql) —
     either way it's re-runnable and self-healing.
   - **Local CLI**: `supabase link --project-ref <ref> && supabase db push`
     (full steps in [`supabase/README.md`](supabase/README.md)).
   Never load `seed.sql` into a live project — it's the fictional demo
   community. If it ever lands there, `npm run admin -- purge-demo` removes it.
2. **Wire up email links.** In **Supabase → Authentication → URL
   configuration**, set **Site URL** (and redirect URLs) to your Netlify domain
   — confirmation and reset emails link back to the app from there. New
   projects confirm emails by default; turn that off in **Authentication →
   Providers → Email** only if you want instant sign-in for a private preview.
3. **Put the deploy secrets in GitHub** and the
   [`deploy-web.yml`](.github/workflows/deploy-web.yml) workflow builds the
   app and deploys it to Netlify on every push (or manually from the Actions
   tab — *Deploy web app* → **Run workflow**). Five repository secrets
   (Settings → Secrets and variables → Actions):
   | Secret | Where the value comes from |
   | --- | --- |
   | `SUPABASE_DB_URL` | Supabase project → **Connect** button (top of the page) → **Session pooler** → the URI string, with `[YOUR-PASSWORD]` replaced |
   | `EXPO_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL (bare `https://<ref>.supabase.co`) |
   | `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → anon `public` key |
   | `NETLIFY_AUTH_TOKEN` | [Netlify → Personal access tokens](https://app.netlify.com/user/applications) → New access token |
   | `NETLIFY_SITE_ID` | Netlify → Site configuration → General → Site ID |

   Plus the verification secrets (see *Identity verification (Didit)* and *Admin
   AI assist* below): `DIDIT_API_KEY`, `DIDIT_WORKFLOW_ID`,
   `DIDIT_WEBHOOK_SECRET`, and `OPENAI_API_KEY` (admin AI assist only).

   The build reads the Supabase values from secrets, so nothing has to be
   configured in Netlify itself. If the app ever shows "Backend not
   connected", the env secrets are missing — the workflow says exactly which.
4. **One Netlify toggle.** So Actions is the only deployer, turn off Netlify's
   own git builds: Netlify → Site configuration → Build & deploy → your
   repository → **Stop auto publishing**. (Leave the site connected; the
   `netlify.toml` redirects/headers are baked into the export either way.)

   Then sign up for real. Native builds (TestFlight / Play Store) use the same
   env values — see [`CrushlyApp/README.md`](CrushlyApp/README.md).

### Switch the live site to another Netlify account

When one Netlify account's deploys are blocked — e.g. a stuck *"Skipped due to
account credit usage exceeded"* flag (a known Netlify issue that top-ups don't
always clear, and it can block even manual deploys) — the clean move is a
**new site on another account**. The pipeline follows the `NETLIFY_SITE_ID`
secret, so nothing in the repo changes:

1. **Create a new site in the other account**:
   [app.netlify.com → Add new site → Import an existing project](https://app.netlify.com/start)
   → `dyceelvk/Crushly`, branch `arena/927d4af8-crushly`. (The repo's
   `netlify.toml` carries the whole build config.)
2. **Copy the build env vars onto the new site**: Site configuration →
   Environment variables → add `EXPO_PUBLIC_SUPABASE_URL` and
   `EXPO_PUBLIC_SUPABASE_ANON_KEY` with the same values as the GitHub secrets.
   Git builds need them baked in at build time.
3. **Keep the URL identical (recommended).** Rename the OLD site first
   (Site configuration → General → Change site name → e.g. `mencrushly-old`),
   then rename the NEW site to `mencrushly` (same place). `mencrushly.netlify.app`
   then serves the new site, and the Supabase Site URL, email links and the
   logo inside the emails all keep working untouched. If you skip this, the
   new site gets a fresh `*.netlify.app` address — the deploy workflow points
   Supabase at it automatically on the next run.
4. **Point the pipeline at the new site**: GitHub →
   [Settings → Secrets and variables → Actions](https://github.com/dyceelvk/Crushly/settings/secrets/actions)
   → update:
   - `NETLIFY_SITE_ID` → the new site's **Site ID** (Site configuration → General)
   - `NETLIFY_AUTH_TOKEN` → a [Personal access token](https://app.netlify.com/user/applications)
     from the account that owns the NEW site — only needed if that account is a
     different Netlify login; one token sees every account the same login
     belongs to.
5. **Retire the old site's automation** (optional but tidy): old site → Site
   configuration → Build & deploy → **Stop auto publishing**, and delete the
   `ci-trigger` build hook under **Build hooks**.
6. **Push anything** (or Actions → *Deploy web app* → **Run workflow**). The
   deploy log's *Diagnose Netlify access* step prints the site it is deploying
   to — confirm it shows the new site, then watch the URL update.

   The same switch works in reverse later: point `NETLIFY_SITE_ID` back and the
   pipeline follows.

   **Current state (verified 2026-10-09 by requesting the pages):** the live
   site is **https://crushly-app.netlify.app**, and it serves the latest commit
   (`/` and `/download/` both return 200; `/download/` is byte-identical to
   `CrushlyApp/public/download/index.html`). `crushlyi.netlify.app` and
   `mencrushly.netlify.app` both return **404** — treat any doc or config still
   naming them as stale. The pipeline follows `NETLIFY_SITE_ID`, so renaming a
   site is safe; the email templates now rewrite *any* `*.netlify.app` logo/link
   host to the resolved live site on every deploy.

   **Credit math (why deploys suddenly skip):** on Netlify's credit plan every
   production deploy costs ~15 credits (300 free/month). Earlier the pipeline
   deployed up to **three times per push** (git auto-publish + a build hook +
   a CLI deploy), which burned a fresh account's 300 credits in a few hours.
   The pipeline now keeps to **one deploy per push**: git auto-publish is the
   deployer, and the workflow's CLI deploy only runs when auto-publish is off.
   If builds show "Skipped due to account credit usage exceeded", either top up
   (team → Billing) or wait for the monthly reset — and push less often.

## Media storage (Backblaze B2 + Cloudflare Worker)

Member photos, Moments and chat media live in a **private Backblaze B2 bucket**
(10 GB free, no card) served by a **Cloudflare Worker** (free, no card). The
database stays on Supabase — this split is deliberate: Supabase is accounts,
data and realtime; Cloudflare is files.

They were previously in a **public** Supabase bucket, which meant anyone with a
link could fetch any chat photo, forever. Now nothing can read the bucket except
the Worker, and the Worker decides nothing itself: it takes the member's access
token and asks the database (`can_view_media`, `can_manage_media`,
`media_upload_ticket`) whether that member may see, upload or remove the file.
Blocks, connections, profile visibility and Moment expiry therefore keep exactly
the meaning they have everywhere else.

Switching it on is one build-time value:

```
EXPO_PUBLIC_MEDIA_BASE_URL=https://crushly-media.<subdomain>.workers.dev
```

Empty means "keep using Supabase Storage" — the default, and the rollback.
Uploaded files store the URL the Worker returned, so old paths and new URLs both
resolve and nothing has to be rewritten when it flips.

Two things make the 24-hour Moment promise real: a **B2 lifecycle rule** that
deletes everything under `moments/` after a day, and
`.github/workflows/cleanup.yml`, which deletes expired rows (and any older files
still in Supabase Storage) hourly.

Full setup steps, including which GitHub secrets to add:
[`cloudflare/media-worker/README.md`](cloudflare/media-worker/README.md).

## Identity verification (Didit)

Members verify through **Didit** (https://didit.me) — a hosted flow that checks a
government ID, runs a liveness check, and face-matches the selfie to the document.
Crushly never sees the document: only the pass/fail result reaches the profile
(`verified` / `rejected`), and the badge appears automatically.

How it's wired:

- `didit-session` (edge function) — the member taps **Verify with Didit**; we create
  a Didit session (`POST https://verification.didit.me/v3/session/`) and open its
  hosted URL.
- `didit-webhook` (edge function, no JWT — the `X-Signature-V2` HMAC is the auth) —
  Didit's signed webhook settles the member's status. Register this URL in the Didit
  console under **API & Webhooks**:
  `https://yzcssyebozfkmojqqdhc.supabase.co/functions/v1/didit-webhook`
- `didit-status` (edge function) — fallback poll of `GET /v3/session/{id}/decision/`
  when the member returns via the callback or taps **Check status**.

One-time setup:

1. **Create a Didit account**: https://business.didit.me (sandbox starts on signup;
   flip the environment toggle to go live). 500 sessions/month are free.
2. **Create a workflow** in the console (or `POST /v3/workflows/`) with the features
   you want — recommended for an 18+ app: `OCR` (ID document), `LIVENESS`,
   `FACE_MATCH`, `IP_ANALYSIS`, plus `AGE_ESTIMATION` and `AML_SCREENING`. Copy the
   **workflow ID**.
3. **API & Webhooks** in the console sidebar: copy the **API Key**, add the webhook
   URL above, and copy the destination's **Webhook Secret Key**.
4. **Add three secrets** at
   https://github.com/dyceelvk/Crushly/settings/secrets/actions:

   | Secret | Value |
   | --- | --- |
   | `DIDIT_API_KEY` | the API Key from step 3 |
   | `DIDIT_WORKFLOW_ID` | the workflow ID from step 2 |
   | `DIDIT_WEBHOOK_SECRET` | the webhook destination's secret |

   The deploy workflow pushes them into the project (plus `APP_URL`, resolved from
   the live site automatically) and deploys the edge functions on every push.
   Nothing else to configure.

## Admin AI assist (optional)

The vision-model reviewer (`supabase/functions/verify-identity/`) is
**admin-only** — the member app never calls it. It assists manual review of
requests that carry selfies:

```bash
cd CrushlyApp
export SUPABASE_URL=https://yzcssyebozfkmojqqdhc.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=…   # service_role key — never commit it
npm run admin -- review-verification    # members waiting on review
npm run admin -- ai-assist <requestId>  # AI verdict (advisory — you decide)
npm run admin -- decide <requestId> <approved|rejected>
npm run admin -- purge-demo             # remove the fictional demo community
```

It needs the `OPENAI_API_KEY` secret
(https://platform.openai.com/api-keys →
https://github.com/dyceelvk/Crushly/settings/secrets/actions); optional `AI_MODEL`
overrides the default `gpt-4o-mini`.

## Gmail confirmation emails

Sign-up confirmation emails are sent through your Gmail via SMTP as **6-digit codes**
(no links to click): the branded template with the Crushly logo lives in
`supabase/email-templates/confirm-signup.html` and is re-applied on every deploy —
edit that file (not the dashboard) to change the email.
Wire it once — it lives in GitHub secrets and re-applies on every deploy:

1. Turn on **2-Step Verification**: https://myaccount.google.com/signinoptions/two-step-verification
2. Create an **App Password** (name it `Crushly SMTP`, choose Mail): https://myaccount.google.com/apppasswords
   → you get a 16-character password. Never paste it in chat — secrets only.
3. Add three secrets at https://github.com/dyceelvk/Crushly/settings/secrets/actions :
   - `SUPABASE_ACCESS_TOKEN` — create one at https://supabase.com/dashboard/account/tokens
   - `GMAIL_SMTP_USER` — your full Gmail address (e.g. `Dyceelvk@gmail.com`)
   - `GMAIL_SMTP_PASS` — the 16-character App Password from step 2
4. Tell the agent "done" — the next deploy wires it (SMTP `smtp.gmail.com:465`, Confirm email ON,
   branded OTP template). The `Wire Gmail confirmation` step reports success and
   points Supabase at whichever site the pipeline targets — currently
   **https://crushlyi.netlify.app** (see *Switch the live site to another Netlify
   account* above). The logo the email embeds is served from
   `<live site>/brand/crushly-mark.png` (repo: `CrushlyApp/public/brand/`).

Prefer clicking by hand? SMTP lives at
https://supabase.com/dashboard/project/yzcssyebozfkmojqqdhc/auth/providers (Email → SMTP Settings)
and the link landing pages at
https://supabase.com/dashboard/project/yzcssyebozfkmojqqdhc/auth/url-configuration
(Site URL = your live site's URL, plus `<live site>/**` as a redirect).

## Quick links (this project)

| Where | Link |
| --- | --- |
| GitHub secrets (all five go here) | https://github.com/dyceelvk/Crushly/settings/secrets/actions |
| GitHub Actions (run/see workflows) | https://github.com/dyceelvk/Crushly/actions |
| Netlify personal access tokens | https://app.netlify.com/user/applications |
| Live site | https://crushly-app.netlify.app (follows the `NETLIFY_SITE_ID` secret) |
| Netlify site (deploys) | https://app.netlify.com/sites/crushly-app/deploys |
| Netlify site configuration (Site ID, git builds) | https://app.netlify.com/sites/crushly-app/configuration |
| Android download page | https://crushly-app.netlify.app/download/ |
| E2E auth-journey checks (manual run) | https://github.com/dyceelvk/Crushly/actions/workflows/e2e.yml |
| Supabase SQL editor (fallback setup) | https://supabase.com/dashboard/project/_/sql/new |
| Supabase API keys (URL + anon) | https://supabase.com/dashboard/project/_/settings/api |
| Supabase database (reset DB password) | https://supabase.com/dashboard/project/_/settings/database |
| Supabase Connect dialog (Session pooler URI) | https://supabase.com/dashboard/project/_/connect |
| Supabase auth settings (confirm email, URLs) | https://supabase.com/dashboard/project/_/auth/providers |

## What works end to end

Everything below is backed by Supabase (Auth, Postgres with row-level security,
RPC functions and Storage):

- Sign up, sign in, sign out, change email or password, sign out other sessions, pause account, delete account
- Onboarding: intentions, basics, photo upload (resized on device), bio, interests, and discovery preferences
- Discover with filters (age, distance, connection type, interests). Distance is always rounded and exact location is never returned.
- Crush, Deep Crush with a note, Pass, Mutual Crush celebration, and removing a Connection
- Crushes: *Crushing on you* / *Your crushes* / *Mutual Crushes*
- Messaging: text, photos, voice notes, **video notes**, **voice calls** (peer-to-peer WebRTC on the web app), stickers, shared profiles, Crush reactions, optional read receipts, and new messages within ~3 seconds
- Message search: filter conversations by name, preview or message text
- Moments (expire after 24h): text or photo, viewer with reply, react and Crush
- Notification center with live in-app toasts
- Safety: block, unblock, report (from profiles, chats and Moments), hide from Discover, who can message or Crush you, show or hide online status, distance, age and read receipts
- Verification: selfie with a random pose. Requests stay **pending** until a moderator approves them.
- Settings: discovery, privacy, notifications, dark/light/system appearance, and support pages

## Deliberately not faked

These features need a third-party service or a human in the loop. Rather than pretend, the UI says so honestly:

| Feature | Status |
| --- | --- |
| **Crushly Plus** | The paywall screen records interest (`profiles.plus_interest`). There's no payment provider yet, so nothing is charged and no Plus features unlock. Incognito returns `402 plus_required`. |
| **Verification review** | Didit settles most sessions automatically. "In Review" cases queue for a human: `npm run admin -- review-verification` (optionally with the admin-only AI assist `ai-assist`). |
| **Reports** | Stored in `reports`. Triaged with `supabase/scripts/admin.mjs reports` — no moderator dashboard yet. |
| **Push notifications** | In-app notifications and toasts work. OS push needs Expo push credentials and isn't wired up yet. |
| **Voice calls** | Real peer-to-peer WebRTC audio calls (signalled over Supabase Realtime, STUN via Google). **Web only** — React Native needs a native WebRTC module; the call button says so honestly on native and suggests a voice/video note instead. |
| **Video notes** | Record up to 60s (web: in-app recorder; native: device camera), send as a message, play inline. |
| **GIFs** | Replaced by a built-in sticker pack, so no GIF API key is needed. |
| **Realtime** | Polling through react-query (a few seconds in an open chat). Supabase Realtime channels are an easy swap-in when you scale. |

## Legal and company details

Everything about the company and the legal pages lives in two places:

| What | Where |
| --- | --- |
| Company name, emails, website base URL, RC number, registered address | [`CrushlyApp/src/lib/company.ts`](CrushlyApp/src/lib/company.ts) |
| Terms, Privacy Policy, Community Guidelines, Help, Safety tips copy | [`CrushlyApp/src/screens/settings/Info.tsx`](CrushlyApp/src/screens/settings/Info.tsx) |

**Turning on the website links.** `COMPANY_SITE` in `lib/company.ts` is
**empty on purpose** — the app must never link to a domain Riel Inc. doesn't
own. Set it once the Riel landing page is live:

```ts
const COMPANY_SITE = 'https://riel.inc';   // ← the only line to change
```

Every legal page then grows a **“Read this on the Riel Inc. website”** button
pointing at `legal/terms`, `legal/privacy`, `legal/guidelines` and
`legal/safety` on that domain. Nothing else needs editing. While it's empty
those buttons stay hidden and the in-app copy is the whole document.

`COMPANY_REGISTRATION` (RC number) and `COMPANY_ADDRESS` are marked
`[…]` placeholders. They are skipped automatically in the app copy until
filled in, so fill them in `lib/company.ts` before launch.

**Governing law — deliberately anonymous in the app.** `COMPANY_JURISDICTION`
in `lib/company.ts` is empty, so the Terms read *“the laws of the jurisdiction
in which Riel Inc. is registered”* and the app never publishes where the
company is incorporated. Set that one constant to make the clause specific.
**Keep the value out of this repository** — the repo is public, so decide the
jurisdiction privately with counsel and never commit it, name it in the app
copy, or write it in this README.

**Still needs a lawyer.** The in-app wording is a strong, product-accurate
draft, not legal advice. Before a public launch have qualified counsel in the
chosen jurisdiction review it, and check in particular:

- whether Riel Inc. must register as a data controller with the data
  protection authority of the chosen jurisdiction, and
- that the liability cap, the indemnity, the class-claim restriction and the
  costs clause are enforceable against consumers there as drafted.

## Before launch

- The **Terms, Privacy and Community Guidelines** copy in `CrushlyApp/src/screens/settings/Info.tsx` is a strong draft written for the product. Have it reviewed by qualified counsel — see *Legal and company details* above.
- The seed uses 16 AI-generated portraits (`supabase/seed/photos/`) for demo members. Don't ship them as real users.
- Turn on email confirmation in Supabase Auth, and keep the service role key out of the app (it belongs only in server-side scripts).

## Tests

```bash
# App: typecheck + unit tests (format helpers, message previews, Moments feed)
cd CrushlyApp && npm run typecheck && npm test

# Backend: schema, seed and RPC smoke tests on a throwaway Postgres
python -m venv /tmp/pgvenv && /tmp/pgvenv/bin/pip install pgserver psycopg2-binary
/tmp/pgvenv/bin/python supabase/tests/run.py
```

Both run on every push in `.github/workflows/ci.yml`. The database logic lives
in `supabase/migrations/` (SQL functions mirror the old Express routes one for
one); `supabase/README.md` explains the layout.

### Android test APK and foreground voice calls

The **Build Android test APK** Actions workflow compiles a standalone universal ARM
Android APK (32-bit `armeabi-v7a` and 64-bit `arm64-v8a`) using the existing `EXPO_PUBLIC_SUPABASE_URL` and
`EXPO_PUBLIC_SUPABASE_ANON_KEY` GitHub secrets. No Expo account or Expo Go is
needed.

**For members:** the **Publish Android download** workflow publishes a single
`.apk` to the `android-test-*` release, and the site serves it at
https://crushly-app.netlify.app/download/ — one tap, no ZIP, no GitHub account.
**For developers:** the same APK is also the **Crushly-Android-test-APK**
artifact of the [Build Android test APK run](https://github.com/dyceelvk/Crushly/actions/workflows/build-android.yml)
(that one is zipped — unzip it, install `Crushly-android-test.apk`, and grant
microphone access).
Android 9 (API 28) is the minimum supported version.
The build verifies native libraries for both architectures, the APK signature,
and the minimum Android version; `COMPATIBILITY.txt` records the APK metadata.
The internal release build embeds the JavaScript and uses Android's generated
debug signing certificate; it is **not** a Play Store release/signing setup.

Both members must open the same permitted conversation. Tap the phone icon in
the chat header, Accept on the other phone, then test audio, mute, decline,
cancel and hang-up. Leaving Crushly ends the call. Background/closed-app ringing,
Bluetooth route selection and system call integration are not implemented.
Signaling uses authenticated private Realtime rooms scoped to the two members;
SDP exchange is not treated as a successful connection.

Direct connectivity uses STUN. Cellular/restrictive NATs often need a TURN relay.
For a coturn server with REST authentication, add `TURN_SHARED_SECRET` and
`TURN_URLS` (comma-separated `turn:` / `turns:` URLs) in
[GitHub Actions secrets](https://github.com/dyceelvk/Crushly/settings/secrets/actions),
or [Supabase server secrets](https://supabase.com/dashboard/project/yzcssyebozfkmojqqdhc/functions/secrets).
The `call-ice` function issues one-hour credentials only to members of a live
call room. Never put the shared secret in an `EXPO_PUBLIC_*` variable.
Without a configured relay, call success depends on both networks.

### APK secrets and startup checks

Treat the APK and its JavaScript as public: decompiling must not reveal server
credentials. Supabase's project URL and publishable/legacy `anon` key are public
client configuration, not administrator credentials. Each signed-in member gets
their own auth session; RLS and server RPC authorization enforce access. Native
sessions are stored with Expo SecureStore. This does not protect a session from
a fully compromised/rooted device, and obfuscation is not a security boundary.

Didit, database, service-role, SMTP, Netlify, AI and TURN shared-secret credentials
belong only in GitHub deployment secrets / Supabase server secrets. The Android
compiler receives only the two public Supabase variables. Its client-key check
rejects unknown key types and secret/service-role keys before export. A separate,
post-build check compares APK contents against known server credentials without
printing values. This is a leakage guard, not a complete penetration test.

APK compilation and architecture checks do not prove launchability. Android
builds now also compile an x86_64 release for an Android 9 emulator, assert that
**Welcome to Crushly / Get Started** appears, and test a second cold launch
before publishing the ARM test APK. This does not replace real Samsung/ARM
hardware testing.
